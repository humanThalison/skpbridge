// popup.js - Script do popup para SketchUp Bridge v2

class PopupManager {
  constructor() {
    this.isConnected = false;
    this.connectionCheckInterval = null;
    
    console.log("[Popup] PopupManager inicializado");
  }

  async init() {
    console.log("[Popup] Inicializando popup");
    
    // Configurar event listeners
    this.setupEventListeners();
    
    // Verificar status inicial da conexão
    await this.checkConnectionStatus();
    
    // Carregar histórico de cores
    this.loadColorHistory();
    
    // Iniciar verificação periódica da conexão
    this.startConnectionMonitoring();
  }

  setupEventListeners() {
    // Botão Color Picker
    document.getElementById("startPicker").addEventListener("click", () => {
      this.startColorPicker();
    });

    // Botões de conexão
    document.getElementById("connectBtn").addEventListener("click", () => {
      this.connectToSketchUp();
    });

    document.getElementById("disconnectBtn").addEventListener("click", () => {
      this.disconnectFromSketchUp();
    });

    // Link sobre
    document.getElementById("aboutLink").addEventListener("click", (e) => {
      e.preventDefault();
      this.showAbout();
    });
  }

  async startColorPicker() {
    try {
      console.log("[Popup] Iniciando color picker");
      
      // Obter aba ativa
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      
      // Enviar mensagem para o content script
      chrome.tabs.sendMessage(tab.id, {action: "startColorPicker"});
      
      // Fechar popup
      window.close();
      
    } catch (error) {
      console.error("[Popup] Erro ao iniciar color picker:", error);
      this.showToast("Erro ao iniciar color picker", "error");
    }
  }

  async connectToSketchUp() {
    try {
      console.log("[Popup] Conectando ao SketchUp");
      this.updateConnectionStatus("connecting", "Conectando...");
      
      const response = await this.sendMessage({action: "connectToSketchUp"});
      
      if (response.success) {
        console.log("[Popup] Conectado com sucesso");
        this.updateConnectionStatus("connected", "Conectado ao SketchUp");
        this.showToast("Conectado ao SketchUp", "success");
      } else {
        throw new Error(response.error);
      }
      
    } catch (error) {
      console.error("[Popup] Erro ao conectar:", error);
      this.updateConnectionStatus("disconnected", "Falha na conexão");
      this.showToast(`Erro ao conectar: ${error.message}`, "error");
    }
  }

  async disconnectFromSketchUp() {
    try {
      console.log("[Popup] Desconectando do SketchUp");
      
      const response = await this.sendMessage({action: "disconnectFromSketchUp"});
      
      if (response.success) {
        console.log("[Popup] Desconectado com sucesso");
        this.updateConnectionStatus("disconnected", "Desconectado");
        this.showToast("Desconectado do SketchUp", "info");
      }
      
    } catch (error) {
      console.error("[Popup] Erro ao desconectar:", error);
      this.showToast(`Erro ao desconectar: ${error.message}`, "error");
    }
  }

  async checkConnectionStatus() {
    try {
      console.log("[Popup] Verificando status da conexão");
      
      const response = await this.sendMessage({action: "checkSketchUpConnection"});
      
      if (response.isConnected) {
        this.updateConnectionStatus("connected", "Conectado ao SketchUp");
      } else {
        this.updateConnectionStatus("disconnected", "SketchUp desconectado");
      }
      
    } catch (error) {
      console.error("[Popup] Erro ao verificar conexão:", error);
      this.updateConnectionStatus("disconnected", "Erro na verificação");
    }
  }

  updateConnectionStatus(status, message) {
    const statusDot = document.getElementById("statusDot");
    const statusText = document.getElementById("connectionStatus");
    const connectBtn = document.getElementById("connectBtn");
    const disconnectBtn = document.getElementById("disconnectBtn");

    // Remover classes anteriores
    statusDot.className = "status-dot";
    
    // Adicionar nova classe
    statusDot.classList.add(status);
    
    // Atualizar texto
    statusText.textContent = message;
    
    // Atualizar botões
    if (status === "connected") {
      connectBtn.disabled = true;
      disconnectBtn.disabled = false;
      this.isConnected = true;
    } else if (status === "disconnected") {
      connectBtn.disabled = false;
      disconnectBtn.disabled = true;
      this.isConnected = false;
    } else if (status === "connecting") {
      connectBtn.disabled = true;
      disconnectBtn.disabled = true;
      this.isConnected = false;
    }
  }

  startConnectionMonitoring() {
    // Verificar conexão a cada 5 segundos
    this.connectionCheckInterval = setInterval(() => {
      this.checkConnectionStatus();
    }, 5000);
  }

  stopConnectionMonitoring() {
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
      this.connectionCheckInterval = null;
    }
  }

  async loadColorHistory() {
    try {
      console.log("[Popup] Carregando histórico de cores");
      
      const result = await chrome.storage.local.get(["colorHistory"]);
      const colors = result.colorHistory || [];
      const historyDiv = document.getElementById("colorHistory");
      
      if (colors.length === 0) {
        historyDiv.innerHTML = '<div class="status">Nenhuma cor capturada ainda</div>';
        return;
      }
      
      historyDiv.innerHTML = "";
      
      // Mostrar últimas 5 cores
      colors.slice(0, 5).forEach(color => {
        const item = document.createElement("div");
        item.className = "color-item";
        item.innerHTML = `
          <div class="color-preview" style="background-color: ${color.hex}"></div>
          <div class="color-info">
            <div class="color-hex">${color.hex}</div>
            <div class="color-rgb">${color.rgb}</div>
          </div>
        `;
        
        item.addEventListener("click", () => {
          this.copyToClipboard(color.hex);
          this.showToast("Cor copiada!", "success");
        });
        
        historyDiv.appendChild(item);
      });
      
    } catch (error) {
      console.error("[Popup] Erro ao carregar histórico:", error);
      document.getElementById("colorHistory").innerHTML = '<div class="status">Erro ao carregar histórico</div>';
    }
  }

  async saveColorToHistory(colorData) {
    try {
      const result = await chrome.storage.local.get(["colorHistory"]);
      const colors = result.colorHistory || [];
      
      // Verificar se a cor já existe
      const exists = colors.some(c => c.hex === colorData.hex);
      if (exists) return;
      
      // Adicionar nova cor no início
      colors.unshift({
        hex: colorData.hex,
        rgb: `rgb(${colorData.r}, ${colorData.g}, ${colorData.b})`,
        timestamp: Date.now()
      });
      
      // Manter apenas últimas 20 cores
      if (colors.length > 20) {
        colors.splice(20);
      }
      
      await chrome.storage.local.set({colorHistory: colors});
      
    } catch (error) {
      console.error("[Popup] Erro ao salvar cor no histórico:", error);
    }
  }

  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error("[Popup] Erro ao copiar:", err);
      
      // Fallback para navegadores mais antigos
      const textArea = document.createElement("textarea");
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
      } catch (err) {
        console.error("[Popup] Fallback copy failed:", err);
      }
      document.body.removeChild(textArea);
    }
  }

  showToast(message, type = "info") {
    console.log(`[Popup] Toast: ${message} (${type})`);
    
    // Remover toast anterior se existir
    const existingToast = document.querySelector('.toast');
    if (existingToast) {
      existingToast.remove();
    }
    
    const toast = document.createElement("div");
    toast.className = "toast";
    
    const colors = {
      error: "#f44336",
      success: "#4CAF50",
      info: "#2196F3",
      warning: "#FF9800"
    };
    
    const bgColor = colors[type] || colors.info;
    
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: ${bgColor};
      color: white;
      padding: 12px 20px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      animation: slideUp 0.3s ease;
    `;
    
    // Adicionar animação CSS
    if (!document.querySelector('#toast-styles')) {
      const style = document.createElement('style');
      style.id = 'toast-styles';
      style.textContent = `
        @keyframes slideUp {
          from { transform: translate(-50%, 100%); opacity: 0; }
          to { transform: translate(-50%, 0); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }
    
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
      if (document.body.contains(toast)) {
        toast.style.animation = 'slideUp 0.3s ease reverse';
        setTimeout(() => {
          if (document.body.contains(toast)) {
            document.body.removeChild(toast);
          }
        }, 300);
      }
    }, 3000);
  }

  showAbout() {
    const aboutText = `
SketchUp Bridge v2.0.0

Ponte de comunicação entre SketchUp e extensões do navegador via WebSocket.

Funcionalidades:
• Envio de imagens como materiais
• Envio de imagens como componentes  
• Criação de cores a partir do RGB
• Comunicação em tempo real via WebSocket
• Reconexão automática

Desenvolvido pela equipe SketchUp Bridge
© 2025
    `.trim();
    
    alert(aboutText);
  }

  sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  // Cleanup ao fechar popup
  cleanup() {
    this.stopConnectionMonitoring();
  }
}

// Instanciar e inicializar o gerenciador do popup
const popupManager = new PopupManager();

// Inicializar quando o DOM estiver carregado
document.addEventListener("DOMContentLoaded", () => {
  popupManager.init();
});

// Cleanup ao descarregar
window.addEventListener("beforeunload", () => {
  popupManager.cleanup();
});

// Listener para atualizações de cor do background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "colorCaptured") {
    popupManager.saveColorToHistory(request.color);
    popupManager.loadColorHistory();
  }
});

console.log("[Popup] SketchUp Bridge v2 popup script carregado");

