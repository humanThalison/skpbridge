// background.js - Service Worker para SketchUp Bridge v2
// Gerencia conexão WebSocket com SketchUp e comunicação com content scripts

class SketchUpWebSocketManager {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 2000; // 2 segundos
    this.messageQueue = [];
    this.pendingRequests = new Map();
    this.requestId = 0;
    
    console.log("[Background] SketchUpWebSocketManager inicializado");
  }
  
  // Conectar ao SketchUp via WebSocket
  connect() {
    if (this.isConnected || (this.ws && this.ws.readyState === WebSocket.CONNECTING)) {
      console.log("[Background] Já conectado ou conectando ao SketchUp");
      return Promise.resolve();
    }
    
    return new Promise((resolve, reject) => {
      try {
        console.log("[Background] Tentando conectar ao SketchUp WebSocket...");
        this.ws = new WebSocket('ws://localhost:8080');
        
        this.ws.onopen = () => {
          console.log("[Background] Conectado ao SketchUp WebSocket");
          this.isConnected = true;
          this.reconnectAttempts = 0;
          
          // Processar fila de mensagens
          this.processMessageQueue();
          
          resolve();
        };
        
        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };
        
        this.ws.onclose = (event) => {
          console.log(`[Background] Conexão WebSocket fechada: ${event.code} - ${event.reason}`);
          this.isConnected = false;
          this.ws = null;
          
          // Tentar reconectar se não foi fechamento intencional
          if (event.code !== 1000) {
            this.scheduleReconnect();
          }
        };
        
        this.ws.onerror = (error) => {
          console.error("[Background] Erro WebSocket:", error);
          this.isConnected = false;
          reject(error);
        };
        
        // Timeout para conexão
        setTimeout(() => {
          if (!this.isConnected) {
            this.ws.close();
            reject(new Error("Timeout na conexão WebSocket"));
          }
        }, 5000);
        
      } catch (error) {
        console.error("[Background] Erro ao criar WebSocket:", error);
        reject(error);
      }
    });
  }
  
  // Desconectar do SketchUp
  disconnect() {
    if (this.ws) {
      console.log("[Background] Desconectando do SketchUp WebSocket");
      this.ws.close(1000, "Desconexão intencional");
      this.ws = null;
    }
    this.isConnected = false;
  }
  
  // Agendar reconexão
  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log("[Background] Máximo de tentativas de reconexão atingido");
      return;
    }
    
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * this.reconnectAttempts;
    
    console.log(`[Background] Agendando reconexão em ${delay}ms (tentativa ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      this.connect().catch(error => {
        console.error("[Background] Falha na reconexão:", error);
      });
    }, delay);
  }
  
  // Enviar mensagem para o SketchUp
  sendMessage(action, payload = {}) {
    return new Promise((resolve, reject) => {
      const requestId = ++this.requestId;
      const message = {
        id: requestId,
        action: action,
        payload: payload
      };
      
      // Armazenar callback para resposta
      this.pendingRequests.set(requestId, { resolve, reject, timestamp: Date.now() });
      
      if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify(message));
          console.log(`[Background] Mensagem enviada: ${action}`, payload);
        } catch (error) {
          this.pendingRequests.delete(requestId);
          reject(error);
        }
      } else {
        // Adicionar à fila se não conectado
        this.messageQueue.push({ message, resolve, reject });
        console.log(`[Background] Mensagem adicionada à fila: ${action}`);
        
        // Tentar conectar se não estiver conectado
        if (!this.isConnected) {
          this.connect().catch(error => {
            console.error("[Background] Falha ao conectar para enviar mensagem:", error);
          });
        }
      }
      
      // Timeout para resposta
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error("Timeout na resposta do SketchUp"));
        }
      }, 30000); // 30 segundos
    });
  }
  
  // Processar fila de mensagens
  processMessageQueue() {
    while (this.messageQueue.length > 0 && this.isConnected) {
      const { message, resolve, reject } = this.messageQueue.shift();
      
      try {
        this.ws.send(JSON.stringify(message));
        console.log(`[Background] Mensagem da fila enviada: ${message.action}`);
        
        // Armazenar callback para resposta
        this.pendingRequests.set(message.id, { resolve, reject, timestamp: Date.now() });
      } catch (error) {
        reject(error);
      }
    }
  }
  
  // Manipular mensagem recebida
  handleMessage(data) {
    try {
      const response = JSON.parse(data);
      console.log("[Background] Resposta recebida do SketchUp:", response);
      
      // Se tem ID, é resposta a uma requisição específica
      if (response.id && this.pendingRequests.has(response.id)) {
        const { resolve, reject } = this.pendingRequests.get(response.id);
        this.pendingRequests.delete(response.id);
        
        if (response.success !== false) {
          resolve(response);
        } else {
          reject(new Error(response.error || "Erro desconhecido do SketchUp"));
        }
      }
      
    } catch (error) {
      console.error("[Background] Erro ao processar resposta:", error);
    }
  }
  
  // Verificar status da conexão
  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      readyState: this.ws ? this.ws.readyState : WebSocket.CLOSED,
      reconnectAttempts: this.reconnectAttempts
    };
  }
}

// Instância global do gerenciador WebSocket
const wsManager = new SketchUpWebSocketManager();

// Configurar menus de contexto
chrome.runtime.onInstalled.addListener(() => {
  console.log("[Background] Extensão SketchUp Bridge v2 instalada");
  
  // Menu para enviar imagem como material
  chrome.contextMenus.create({
    id: "sendImageAsMaterial",
    title: "Enviar para SketchUp como Material",
    contexts: ["image"]
  });
  
  // Menu para enviar imagem como componente
  chrome.contextMenus.create({
    id: "sendImageAsComponent", 
    title: "Enviar para SketchUp como Componente",
    contexts: ["image"]
  });
  
  // Conectar automaticamente ao SketchUp
  setTimeout(() => {
    wsManager.connect().catch(error => {
      console.log("[Background] Falha na conexão inicial com SketchUp:", error.message);
    });
  }, 5000);
});

// Manipular cliques nos menus de contexto
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "sendImageAsMaterial") {
    handleImageToSketchUp(info, tab, "material");
  } else if (info.menuItemId === "sendImageAsComponent") {
    handleImageToSketchUp(info, tab, "component");
  }
});

// Função para processar imagens para o SketchUp
async function handleImageToSketchUp(info, tab, type) {
  try {
    console.log(`[Background] Processando imagem como ${type}:`, info.srcUrl);
    
    // Enviar mensagem para o content script processar a imagem
    chrome.tabs.sendMessage(tab.id, {
      action: "processImageForSketchUp",
      imageUrl: info.srcUrl,
      type: type
    });
    
  } catch (error) {
    console.error("[Background] Erro ao processar imagem:", error);
  }
}

// Listener para mensagens dos content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("[Background] Mensagem recebida:", request.action);
  
  // Capturar screenshot para o color picker
  if (request.action === 'captureScreen') {
    chrome.tabs.captureVisibleTab(null, {format: 'png'}, (dataUrl) => {
      if (chrome.runtime.lastError) {
        console.error('[Background] Erro ao capturar tela:', chrome.runtime.lastError);
        sendResponse({error: chrome.runtime.lastError.message});
      } else {
        sendResponse({screenshot: dataUrl});
      }
    });
    return true; // Indica resposta assíncrona
  }
  
  // Enviar cor para o SketchUp
  if (request.action === 'sendColorToSketchUp') {
    sendColorToSketchUp(request.color)
      .then(response => sendResponse({success: true, result: response}))
      .catch(error => sendResponse({success: false, error: error.message}));
    return true; // Indica resposta assíncrona
  }
  
  // Enviar imagem para o SketchUp
  if (request.action === 'sendImageToSketchUp') {
    sendImageToSketchUp(request.imageData, request.type)
      .then(response => sendResponse({success: true, result: response}))
      .catch(error => sendResponse({success: false, error: error.message}));
    return true; // Indica resposta assíncrona
  }
  
  // Verificar conexão com SketchUp
  if (request.action === 'checkSketchUpConnection') {
    checkSketchUpConnection()
      .then(isConnected => sendResponse({isConnected: isConnected}))
      .catch(error => sendResponse({isConnected: false, error: error.message}));
    return true; // Indica resposta assíncrona
  }
  
  // Conectar ao SketchUp
  if (request.action === 'connectToSketchUp') {
    wsManager.connect()
      .then(() => sendResponse({success: true}))
      .catch(error => sendResponse({success: false, error: error.message}));
    return true; // Indica resposta assíncrona
  }
  
  // Desconectar do SketchUp
  if (request.action === 'disconnectFromSketchUp') {
    wsManager.disconnect();
    sendResponse({success: true});
  }
});

// Enviar cor para o SketchUp via WebSocket
async function sendColorToSketchUp(colorData) {
  try {
    console.log("[Background] Enviando cor para SketchUp:", colorData);
    
    const response = await wsManager.sendMessage('sendColor', {
      r: colorData.r,
      g: colorData.g,
      b: colorData.b,
      hex: colorData.hex
    });
    
    console.log("[Background] Cor enviada com sucesso:", response);
    return response;
    
  } catch (error) {
    console.error("[Background] Erro ao enviar cor:", error);
    throw error;
  }
}

// Enviar imagem para o SketchUp via servidor intermediário + WebSocket
async function sendImageToSketchUp(imageData, type) {
  try {
    console.log(`[Background] Enviando imagem como ${type} para SketchUp`);
    
    // Primeiro, enviar para o servidor intermediário
    const serverResponse = await fetch('https://renan3d.com.br/copiaecola/upload.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image: imageData,
        type: type,
        timestamp: Date.now()
      })
    });
    
    if (!serverResponse.ok) {
      const errorText = await serverResponse.text();
      throw new Error(`Falha ao enviar imagem para o servidor: ${serverResponse.status} ${serverResponse.statusText} - ${errorText}`);
    }
    
    const result = await serverResponse.json();
    console.log("[Background] Imagem enviada para servidor intermediário:", result);
    
    // Depois, notificar o SketchUp via WebSocket para buscar a imagem
    const sketchupResponse = await wsManager.sendMessage('sendImage', {
      imageId: result.imageId,
      type: type
    });
    
    console.log("[Background] SketchUp notificado com sucesso:", sketchupResponse);
    return sketchupResponse;
    
  } catch (error) {
    console.error("[Background] Erro ao enviar imagem:", error);
    throw error;
  }
}

// Função para verificar a conexão com o SketchUp
async function checkSketchUpConnection() {
  try {
    if (!wsManager.isConnected) {
      // Tentar conectar se não estiver conectado
      await wsManager.connect();
    }
    
    // Enviar ping para verificar se está realmente ativo
    const response = await wsManager.sendMessage('checkConnection');
    return response && response.isConnected;
    
  } catch (error) {
    console.error('[Background] Erro ao verificar conexão com SketchUp:', error);
    return false;
  }
}

// Ativar color picker quando o ícone for clicado
chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, {action: 'startColorPicker'});
});

// Listener para inicialização da extensão
chrome.runtime.onStartup.addListener(() => {
  console.log('[Background] Extensão SketchUp Bridge v2 iniciada');
  
  // Conectar automaticamente ao SketchUp
  setTimeout(() => {
    wsManager.connect().catch(error => {
      console.log("[Background] Falha na conexão automática com SketchUp:", error.message);
    });
  }, 5000);
});

// Cleanup ao descarregar
chrome.runtime.onSuspend.addListener(() => {
  console.log('[Background] Extensão sendo suspensa, desconectando WebSocket');
  wsManager.disconnect();
});

console.log("[Background] SketchUp Bridge v2 background script carregado");

