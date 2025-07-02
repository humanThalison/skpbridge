// contentScript.js - Script de conteúdo para SketchUp Bridge v2
// Gerencia captura de cores e processamento de imagens

class SketchUpColorPicker {
  constructor() {
    this.isActive = false;
    this.canvas = null;
    this.ctx = null;
    this.overlay = null;
    this.zoomCanvas = null;
    this.currentColor = null;
    this.isModalActive = false;
    
    console.log("[ContentScript] SketchUpColorPicker inicializado");
  }

  async init() {
    if (this.isActive) {
      console.log("[ContentScript] ColorPicker já está ativo");
      return;
    }
    
    console.log("[ContentScript] Iniciando ColorPicker...");
    try {
      const response = await this.requestScreenshot();
      if (response.error) {
        throw new Error(response.error);
      }
      
      await this.createCanvas(response.screenshot);
      this.createOverlay();
      this.createZoomCanvas();
      this.attachEventListeners();
      this.isActive = true;
      
      this.showNotification("Color Picker ativo! Pressione ESC para sair.", "info");
      console.log("[ContentScript] ColorPicker ativado com sucesso");
      
    } catch (error) {
      console.error("[ContentScript] Erro ao inicializar color picker:", error);
      this.showNotification("Erro ao inicializar color picker: " + error.message, "error");
    }
  }

  requestScreenshot() {
    console.log("[ContentScript] Solicitando screenshot...");
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({action: 'captureScreen'}, response => {
        if (chrome.runtime.lastError) {
          console.error("[ContentScript] Erro ao capturar tela:", chrome.runtime.lastError.message);
          resolve({error: chrome.runtime.lastError.message});
        } else {
          resolve(response);
        }
      });
    });
  }

  async createCanvas(screenshotDataUrl) {
    console.log("[ContentScript] Criando canvas com screenshot");
    return new Promise((resolve) => {
      this.canvas = document.createElement('canvas');
      this.canvas.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        pointer-events: none;
        z-index: 999999;
        opacity: 0;
      `;
      
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
      
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
      this.ctx.imageSmoothingEnabled = false;
      
      const img = new Image();
      img.onload = () => {
        this.ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
        document.body.appendChild(this.canvas);
        console.log("[ContentScript] Canvas criado e imagem desenhada");
        resolve();
      };
      img.onerror = (e) => {
        console.error("[ContentScript] Erro ao carregar imagem:", e);
        resolve();
      };
      img.src = screenshotDataUrl;
    });
  }

  createOverlay() {
    console.log("[ContentScript] Criando overlay");
    this.overlay = document.createElement('div');
    this.overlay.style.cssText = `
      position: fixed;
      top: 20px;
      left: 20px;
      background: rgba(0, 0, 0, 0.9);
      color: white;
      padding: 15px;
      border-radius: 8px;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      font-size: 12px;
      z-index: 1000000;
      pointer-events: none;
      min-width: 220px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    
    this.overlay.innerHTML = `
      <div style="margin-bottom: 10px; font-weight: bold; color: #4CAF50;">SketchUp Bridge v2 - Color Picker</div>
      <div>HEX: <span id="hex-value" style="font-family: monospace; color: #FFD700;">#000000</span></div>
      <div>RGB: <span id="rgb-value" style="font-family: monospace; color: #87CEEB;">rgb(0, 0, 0)</span></div>
      <div style="width: 50px; height: 50px; border: 2px solid white; margin: 10px 0; border-radius: 4px;" id="color-preview"></div>
      <div style="font-size: 10px; color: #ccc;">Clique para enviar ao SketchUp</div>
    `;
    
    document.body.appendChild(this.overlay);
    document.body.style.cursor = 'crosshair';
  }

  createZoomCanvas() {
    console.log("[ContentScript] Criando zoom canvas");
    this.zoomCanvas = document.createElement('canvas');
    this.zoomCanvas.width = 140;
    this.zoomCanvas.height = 140;
    this.zoomCanvas.style.cssText = `
      position: fixed;
      border: 3px solid white;
      z-index: 1000001;
      pointer-events: none;
      image-rendering: pixelated;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      background: #000;
    `;
    
    this.zoomCtx = this.zoomCanvas.getContext('2d');
    this.zoomCtx.imageSmoothingEnabled = false;
    
    document.body.appendChild(this.zoomCanvas);
  }

  attachEventListeners() {
    console.log("[ContentScript] Anexando event listeners");
    this.mouseMoveHandler = (e) => this.handleMouseMove(e);
    this.clickHandler = (e) => this.handleClick(e);
    this.keyHandler = (e) => this.handleKeyPress(e);
    
    document.addEventListener('mousemove', this.mouseMoveHandler);
    document.addEventListener('click', this.clickHandler, true);
    document.addEventListener('keydown', this.keyHandler);
  }

  detachEventListeners() {
    console.log("[ContentScript] Desanexando event listeners");
    document.removeEventListener('mousemove', this.mouseMoveHandler);
    document.removeEventListener('click', this.clickHandler, true);
    document.removeEventListener('keydown', this.keyHandler);
  }

  handleMouseMove(e) {
    if (!this.isActive || this.isModalActive) return;
    
    const x = e.clientX;
    const y = e.clientY;
    
    // Capturar cor do pixel
    const clampedX = Math.max(0, Math.min(x, this.canvas.width - 1));
    const clampedY = Math.max(0, Math.min(y, this.canvas.height - 1));

    const imageData = this.ctx.getImageData(clampedX, clampedY, 1, 1);
    const [r, g, b] = imageData.data;
    
    // Converter para HEX
    const hex = '#' + [r, g, b].map(x => {
      const hex = x.toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }).join('');
    
    this.currentColor = { r, g, b, hex };
    
    // Atualizar display
    this.updateColorDisplay(hex, `rgb(${r}, ${g}, ${b})`);
    this.updateZoom(clampedX, clampedY);
    this.positionOverlay(e.clientX, e.clientY);
  }

  updateColorDisplay(hex, rgb) {
    const hexElement = document.getElementById('hex-value');
    const rgbElement = document.getElementById('rgb-value');
    const colorPreviewElement = document.getElementById('color-preview');

    if (hexElement) hexElement.textContent = hex;
    if (rgbElement) rgbElement.textContent = rgb;
    if (colorPreviewElement) colorPreviewElement.style.backgroundColor = hex;
  }

  updateZoom(x, y) {
    const size = 14;
    const sx = Math.max(0, Math.min(x - size / 2, this.canvas.width - size));
    const sy = Math.max(0, Math.min(y - size / 2, this.canvas.height - size));

    const captureWidth = Math.min(size, this.canvas.width - sx);
    const captureHeight = Math.min(size, this.canvas.height - sy);

    const imageData = this.ctx.getImageData(sx, sy, captureWidth, captureHeight);
    
    // Criar canvas temporário
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = captureWidth;
    tempCanvas.height = captureHeight;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.putImageData(imageData, 0, 0);
    
    // Limpar e desenhar ampliado
    this.zoomCtx.clearRect(0, 0, 140, 140);
    this.zoomCtx.drawImage(tempCanvas, 0, 0, 140, 140);
    
    // Desenhar crosshair no centro
    this.zoomCtx.strokeStyle = '#ff0000';
    this.zoomCtx.lineWidth = 2;
    this.zoomCtx.beginPath();
    this.zoomCtx.moveTo(60, 70);
    this.zoomCtx.lineTo(80, 70);
    this.zoomCtx.moveTo(70, 60);
    this.zoomCtx.lineTo(70, 80);
    this.zoomCtx.stroke();
    
    // Posicionar zoom canvas
    this.zoomCanvas.style.left = (x + 30) + 'px';
    this.zoomCanvas.style.top = (y + 30) + 'px';
  }

  positionOverlay(x, y) {
    const rect = this.overlay.getBoundingClientRect();
    let left = 20;
    let top = 20;
    
    // Manter overlay sempre visível
    if (x < 280) left = window.innerWidth - rect.width - 20;
    if (y < 180) top = window.innerHeight - rect.height - 20;
    
    this.overlay.style.left = left + 'px';
    this.overlay.style.top = top + 'px';
  }

  async handleClick(e) {
    if (!this.isActive || this.isModalActive) return;
    
    console.log("[ContentScript] Clique detectado");
    e.preventDefault();
    e.stopPropagation();
    
    if (!this.currentColor) {
      console.warn("[ContentScript] currentColor é nulo");
      return;
    }
    
    // Mostrar confirmação
    this.isModalActive = true;
    this.detachEventListeners();
    const confirmed = await this.showColorConfirmation(this.currentColor);
    this.isModalActive = false;
    this.attachEventListeners();
    
    if (confirmed) {
      console.log("[ContentScript] Enviando cor para SketchUp");
      this.sendColorToSketchUp(this.currentColor);
    } else {
      console.log("[ContentScript] Envio de cor cancelado");
    }
  }

  async showColorConfirmation(color) {
    console.log("[ContentScript] Exibindo modal de confirmação");
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.8);
        z-index: 1000002;
        display: flex;
        align-items: center;
        justify-content: center;
      `;
      
      modal.innerHTML = `
        <div style="
          background: white;
          padding: 30px;
          border-radius: 12px;
          text-align: center;
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          box-shadow: 0 8px 24px rgba(0,0,0,0.3);
          max-width: 400px;
          border: 2px solid #4CAF50;
        ">
          <h3 style="margin: 0 0 20px 0; color: #333;">🎨 Criar Material no SketchUp?</h3>
          <div style="
            width: 100px;
            height: 100px;
            background: ${color.hex};
            margin: 0 auto 15px auto;
            border: 3px solid #ddd;
            border-radius: 12px;
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
          "></div>
          <p style="margin: 0 0 20px 0; color: #666; font-size: 14px;">
            <strong>HEX:</strong> <span style="font-family: monospace; background: #f5f5f5; padding: 2px 6px; border-radius: 4px;">${color.hex}</span><br><br>
            <strong>RGB:</strong> <span style="font-family: monospace; background: #f5f5f5; padding: 2px 6px; border-radius: 4px;">rgb(${color.r}, ${color.g}, ${color.b})</span>
          </p>
          <div>
            <button id="confirm-btn" style="
              background: #4CAF50;
              color: white;
              border: none;
              padding: 12px 24px;
              margin: 0 10px;
              border-radius: 6px;
              cursor: pointer;
              font-size: 14px;
              font-weight: bold;
              transition: background 0.3s;
            ">✓ Sim, Criar Material</button>
            <button id="cancel-btn" style="
              background: #f44336;
              color: white;
              border: none;
              padding: 12px 24px;
              margin: 0 10px;
              border-radius: 6px;
              cursor: pointer;
              font-size: 14px;
              font-weight: bold;
              transition: background 0.3s;
            ">✗ Cancelar</button>
          </div>
        </div>
      `;
      
      document.body.appendChild(modal);
      
      // Event listeners para os botões
      modal.querySelector('#confirm-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        console.log("[ContentScript] Confirmação: Sim");
        document.body.removeChild(modal);
        resolve(true);
      });
      
      modal.querySelector('#cancel-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        console.log("[ContentScript] Confirmação: Cancelar");
        document.body.removeChild(modal);
        resolve(false);
      });
      
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          e.stopPropagation();
          console.log("[ContentScript] Confirmação: Clicado fora");
          document.body.removeChild(modal);
          resolve(false);
        }
      });
    });
  }

  async sendColorToSketchUp(color) {
    try {
      this.showNotification("Enviando cor para o SketchUp...", "info");
      
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          action: 'sendColorToSketchUp',
          color: color
        }, response => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
      
      if (response.success) {
        console.log("[ContentScript] Cor enviada com sucesso:", response.result);
        this.showNotification(`✓ Material "${response.result.data.name}" criado no SketchUp!`, "success");
        this.cleanup();
      } else {
        throw new Error(response.error);
      }
      
    } catch (error) {
      console.error("[ContentScript] Erro ao enviar cor:", error);
      this.showNotification(`✗ Erro ao enviar cor: ${error.message}`, "error");
    }
  }

  handleKeyPress(e) {
    if (e.key === 'Escape') {
      console.log("[ContentScript] ESC pressionado, limpando ColorPicker");
      this.cleanup();
    }
  }

  showNotification(message, type = "info") {
    console.log(`[ContentScript] Notificação: ${message} (${type})`);
    const notification = document.createElement('div');
    
    const colors = {
      error: "#f44336",
      success: "#4CAF50",
      info: "#2196F3",
      warning: "#FF9800"
    };
    
    const icons = {
      error: "✗",
      success: "✓",
      info: "ℹ",
      warning: "⚠"
    };
    
    const bgColor = colors[type] || colors.info;
    const icon = icons[type] || icons.info;
    
    notification.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: ${bgColor};
      color: white;
      padding: 15px 25px;
      border-radius: 8px;
      z-index: 1000003;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      max-width: 350px;
      text-align: center;
      font-size: 14px;
      font-weight: bold;
    `;
    
    notification.innerHTML = `${icon} ${message}`;
    document.body.appendChild(notification);
    
    setTimeout(() => {
      if (document.body.contains(notification)) {
        document.body.removeChild(notification);
      }
    }, 4000);
  }

  cleanup() {
    if (!this.isActive) return;
    
    console.log("[ContentScript] Limpando ColorPicker");
    
    // Remover event listeners
    this.detachEventListeners();
    
    // Remover elementos
    if (this.canvas && document.body.contains(this.canvas)) {
      document.body.removeChild(this.canvas);
    }
    
    if (this.overlay && document.body.contains(this.overlay)) {
      document.body.removeChild(this.overlay);
    }
    
    if (this.zoomCanvas && document.body.contains(this.zoomCanvas)) {
      document.body.removeChild(this.zoomCanvas);
    }
    
    // Restaurar cursor
    document.body.style.cursor = 'auto';
    
    this.isActive = false;
    this.canvas = null;
    this.ctx = null;
    this.overlay = null;
    this.zoomCanvas = null;
    this.currentColor = null;
    
    console.log("[ContentScript] ColorPicker limpo");
  }
}

// Classe para processamento de imagens
class ImageProcessor {
  static async processImageForSketchUp(imageUrl, type) {
    console.log(`[ContentScript] Processando imagem como ${type}:`, imageUrl);
    
    try {
      // Mostrar notificação de progresso
      colorPicker.showNotification(`Processando imagem como ${type}...`, "info");
      
      // Converter imagem para PNG base64
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      return new Promise((resolve, reject) => {
        img.onload = async () => {
          canvas.width = img.width;
          canvas.height = img.height;
          
          // Desenhar imagem no canvas
          ctx.drawImage(img, 0, 0);
          
          // Converter para PNG base64
          const base64Data = canvas.toDataURL('image/png');
          console.log("[ContentScript] Imagem convertida para base64");
          
          try {
            // Enviar para o background script
            const response = await new Promise((resolve, reject) => {
              chrome.runtime.sendMessage({
                action: 'sendImageToSketchUp',
                imageData: base64Data,
                type: type
              }, response => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else {
                  resolve(response);
                }
              });
            });
            
            if (response.success) {
              console.log("[ContentScript] Imagem enviada com sucesso:", response.result);
              colorPicker.showNotification(`✓ ${response.result.data.type.charAt(0).toUpperCase() + response.result.data.type.slice(1)} "${response.result.data.name}" criado no SketchUp!`, "success");
              resolve();
            } else {
              throw new Error(response.error);
            }
            
          } catch (error) {
            console.error("[ContentScript] Erro ao enviar imagem:", error);
            colorPicker.showNotification(`✗ Erro ao enviar imagem: ${error.message}`, "error");
            reject(error);
          }
        };
        
        img.onerror = () => {
          const error = new Error('Falha ao carregar imagem');
          console.error("[ContentScript] Falha ao carregar imagem");
          colorPicker.showNotification("✗ Falha ao carregar imagem", "error");
          reject(error);
        };
        
        img.src = imageUrl;
      });
      
    } catch (error) {
      console.error('[ContentScript] Erro ao processar imagem:', error);
      colorPicker.showNotification(`✗ Erro ao processar imagem: ${error.message}`, "error");
      throw error;
    }
  }
}

// Instanciar color picker
const colorPicker = new SketchUpColorPicker();

// Listener para mensagens do background script
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  console.log("[ContentScript] Mensagem recebida:", request.action);
  
  if (request.action === 'startColorPicker') {
    await colorPicker.init();
    sendResponse({success: true});
  }
  
  if (request.action === 'processImageForSketchUp') {
    try {
      await ImageProcessor.processImageForSketchUp(request.imageUrl, request.type);
      sendResponse({success: true});
    } catch (error) {
      sendResponse({success: false, error: error.message});
    }
  }
  
  // Retorna true para indicar resposta assíncrona
  return true;
});

console.log("[ContentScript] SketchUp Bridge v2 content script carregado");

