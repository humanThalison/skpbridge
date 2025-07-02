# main.rb - Arquivo principal do plugin SketchUp Bridge v2
# Implementa um servidor TCP/WebSocket para comunicação com extensões do navegador

require 'sketchup'
require 'net/http'
require 'json'
require 'base64'
require 'thread'
require 'socket'
require 'digest/sha1'
require 'uri'

module SketchUpBridge
  
  # Configurações
  SERVER_PORT = 8080
  EXTERNAL_SERVER = "https://renan3d.com.br/copiaecola/upload.php"
  MATERIAL_WIDTH_METERS = 1.0  # 1 metro ≈ 39.37 polegadas
  
  # Variáveis globais
  @@server = nil
  @@server_thread = nil
  @@server_enabled = false
  @@clients = []
  @@client_threads = []
  
  # Inicializar plugin
  def self.initialize_plugin
    create_menu
    start_server_auto
    puts "[SketchUp Bridge v2] Plugin inicializado."
  end
  
  # Criar menu da extensão
  def self.create_menu
    puts "[SketchUp Bridge v2] Tentando criar menu..."
    menu = UI.menu("Extensions")
    if menu.nil?
      puts "[SketchUp Bridge v2] ERRO: Menu 'Extensions' não encontrado. Não foi possível criar o submenu."
      return
    end
    puts "[SketchUp Bridge v2] Menu 'Extensions' encontrado: #{menu.inspect}"
    
    submenu = menu.add_submenu("SketchUp Bridge v2")
    if submenu.nil?
      puts "[SketchUp Bridge v2] ERRO: Não foi possível criar o submenu 'SketchUp Bridge v2'."
      return
    end
    puts "[SketchUp Bridge v2] Submenu 'SketchUp Bridge v2' criado: #{submenu.inspect}"
    
    submenu.add_item("Ativar Servidor") { start_server }
    submenu.add_item("Desativar Servidor") { stop_server }
    submenu.add_separator
    submenu.add_item("Status do Servidor") { show_server_status }
    submenu.add_item("Configurações") { show_settings }
    submenu.add_separator
    submenu.add_item("Sobre") { show_about }
    puts "[SketchUp Bridge v2] Itens do menu adicionados."
  end
  
  # Iniciar servidor automaticamente
  def self.start_server_auto
    Thread.new do
      sleep(2) # Aguardar inicialização completa do SketchUp
      start_server unless @@server_enabled
    end
  end
  
  # Iniciar servidor TCP/WebSocket
  def self.start_server
    return if @@server_enabled
    
    begin
      @@server = TCPServer.new("0.0.0.0", SERVER_PORT)
      puts "[SketchUp Bridge v2] Servidor TCP iniciado em 0.0.0.0:#{SERVER_PORT}"
      
      @@server_thread = Thread.new do
        loop do
          begin
            client = @@server.accept
            puts "[SketchUp Bridge v2] Nova conexão aceita: #{client.peeraddr}"
            
            client_thread = Thread.new(client) do |client_socket|
              handle_client(client_socket)
            end
            
            @@client_threads << client_thread
            
          rescue => e
            puts "[SketchUp Bridge v2] Erro ao aceitar conexão: #{e.message}"
            break if @@server.closed?
          end
        end
      end
      
      @@server_enabled = true
      UI.messagebox("Servidor SketchUp Bridge v2 iniciado na porta #{SERVER_PORT}")
      
    rescue => e
      UI.messagebox("Erro ao iniciar servidor: #{e.message}")
      puts "[SketchUp Bridge v2] Erro ao iniciar servidor: #{e.message}\n#{e.backtrace.join("\n")}"
    end
  end
  
  # Parar servidor TCP/WebSocket
  def self.stop_server
    return unless @@server_enabled
    
    begin
      # Fechar todas as conexões de clientes
      @@clients.each do |client|
        client.close unless client.closed?
      end
      @@clients.clear
      
      # Terminar todas as threads de clientes
      @@client_threads.each do |thread|
        thread.kill if thread.alive?
      end
      @@client_threads.clear
      
      # Fechar servidor
      @@server.close if @@server && !@@server.closed?
      @@server_thread.kill if @@server_thread && @@server_thread.alive?
      
      @@server = nil
      @@server_thread = nil
      @@server_enabled = false
      
      UI.messagebox("Servidor SketchUp Bridge v2 parado")
      puts "[SketchUp Bridge v2] Servidor parado."
      
    rescue => e
      UI.messagebox("Erro ao parar servidor: #{e.message}")
      puts "[SketchUp Bridge v2] Erro ao parar servidor: #{e.message}\n#{e.backtrace.join("\n")}"
    end
  end
  
  # Manipular cliente conectado
  def self.handle_client(client)
    puts "[SketchUp Bridge v2] handle_client chamado para: #{client.peeraddr}"
    @@clients << client
    puts "[SketchUp Bridge v2] Cliente adicionado. Total de clientes: #{@@clients.length}"
    
    begin
      # Ler primeira linha para determinar se é HTTP ou WebSocket
      first_line = client.gets
      return if first_line.nil?
      
      puts "[SketchUp Bridge v2] Primeira linha recebida: #{first_line.strip}"
      
      if first_line.start_with?('GET') && first_line.include?('Upgrade')
        # Requisição WebSocket
        handle_websocket_handshake(client, first_line)
      else
        # Requisição HTTP normal
        handle_http_request(client, first_line)
      end
      
    rescue => e
      puts "[SketchUp Bridge v2] Erro ao manipular cliente: #{e.message}\n#{e.backtrace.join("\n")}"
    ensure
      @@clients.delete(client)
      client.close unless client.closed?
      puts "[SketchUp Bridge v2] Cliente removido. Total de clientes: #{@@clients.length}"
    end
  end
  
  # Manipular handshake WebSocket
  def self.handle_websocket_handshake(client, first_line)
    headers = {}
    
    # Ler cabeçalhos
    while (line = client.gets) && line.strip != ""
      key, value = line.split(": ", 2)
      headers[key.strip.downcase] = value.strip if key
    end
    
    puts "[SketchUp Bridge v2] Cabeçalhos WebSocket: #{headers.inspect}"
    
    if headers["sec-websocket-key"].nil?
      puts "[SketchUp Bridge v2] ERRO: sec-websocket-key não encontrado nos cabeçalhos."
      send_http_error(client, 400, "Bad Request - Missing Sec-WebSocket-Key")
      return
    end

    # Verificar se é uma requisição WebSocket válida
    if headers["upgrade"] == "websocket" && headers["connection"].downcase.include?("upgrade")
      websocket_key = headers["sec-websocket-key"]
      
      if websocket_key
        # Gerar chave de resposta WebSocket
        accept_key = generate_websocket_accept_key(websocket_key)
        
        # Enviar resposta de handshake
        response = [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          "Sec-WebSocket-Accept: #{accept_key}",
          "",
          ""
        ].join("\r\n")
        
        client.write(response)
        puts "[SketchUp Bridge v2] Handshake WebSocket concluído"
        
        # Iniciar loop de mensagens WebSocket
        handle_websocket_messages(client)
      else
        send_http_error(client, 400, "Bad Request - Missing WebSocket key")
      end
    else
      puts "[SketchUp Bridge v2] ERRO: Requisição não é um upgrade WebSocket válido. Upgrade: #{headers["upgrade"].inspect}, Connection: #{headers["connection"].inspect}"
      send_http_error(client, 400, "Bad Request - Not a WebSocket upgrade")
    end
  end
  
  # Gerar chave de aceitação WebSocket
  def self.generate_websocket_accept_key(websocket_key)
    magic_string = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
    Base64.strict_encode64(Digest::SHA1.digest(websocket_key + magic_string))
  end
  
  # Manipular mensagens WebSocket
  def self.handle_websocket_messages(client)
    puts "[SketchUp Bridge v2] Iniciando loop de mensagens WebSocket"
    
    loop do
      begin
        frame = read_websocket_frame(client)
        break if frame.nil?
        
        puts "[SketchUp Bridge v2] Frame WebSocket recebido: #{frame.inspect}"
        
        if frame[:opcode] == 1 # Texto
          message = frame[:payload]
          puts "[SketchUp Bridge v2] Mensagem WebSocket: #{message}"
          
          response = process_websocket_message(message)
          send_websocket_message(client, response)
          
        elsif frame[:opcode] == 8 # Close
          puts "[SketchUp Bridge v2] Cliente solicitou fechamento da conexão WebSocket"
          break
        end
        
      rescue => e
        puts "[SketchUp Bridge v2] Erro no loop WebSocket: #{e.message}"
        break
      end
    end
  end
  
  # Ler frame WebSocket
  def self.read_websocket_frame(client)
    # Ler primeiro byte (FIN + opcode)
    first_byte = client.read(1)
    return nil if first_byte.nil?
    
    first_byte = first_byte.unpack('C')[0]
    fin = (first_byte & 0x80) != 0
    opcode = first_byte & 0x0F
    
    # Ler segundo byte (MASK + payload length)
    second_byte = client.read(1)
    return nil if second_byte.nil?
    
    second_byte = second_byte.unpack('C')[0]
    masked = (second_byte & 0x80) != 0
    payload_length = second_byte & 0x7F
    
    # Ler comprimento estendido se necessário
    if payload_length == 126
      extended_length = client.read(2)
      return nil if extended_length.nil?
      payload_length = extended_length.unpack('n')[0]
    elsif payload_length == 127
      extended_length = client.read(8)
      return nil if extended_length.nil?
      payload_length = extended_length.unpack('Q>')[0]
    end
    
    # Ler chave de máscara se presente
    mask_key = nil
    if masked
      mask_key = client.read(4)
      return nil if mask_key.nil?
      mask_key = mask_key.unpack('C*')
    end
    
    # Ler payload
    payload = ""
    if payload_length > 0
      payload = client.read(payload_length)
      return nil if payload.nil?
      
      # Desmascarar payload se necessário
      if masked && mask_key
        payload_bytes = payload.unpack('C*')
        payload_bytes.each_with_index do |byte, i|
          payload_bytes[i] = byte ^ mask_key[i % 4]
        end
        payload = payload_bytes.pack('C*')
      end
    end
    
    {
      fin: fin,
      opcode: opcode,
      masked: masked,
      payload_length: payload_length,
      payload: payload
    }
  end
  
  # Enviar mensagem WebSocket
  def self.send_websocket_message(client, message)
    return if client.closed?
    
    begin
      payload = message.to_s
      payload_length = payload.bytesize
      
      # Primeiro byte: FIN=1, opcode=1 (texto)
      first_byte = 0x81
      
      # Segundo byte e comprimento
      if payload_length < 126
        header = [first_byte, payload_length].pack('CC')
      elsif payload_length < 65536
        header = [first_byte, 126, payload_length].pack('CCn')
      else
        header = [first_byte, 127, payload_length].pack('CCQ>')
      end
      
      client.write(header + payload)
      puts "[SketchUp Bridge v2] Mensagem WebSocket enviada: #{message}"
      
    rescue => e
      puts "[SketchUp Bridge v2] Erro ao enviar mensagem WebSocket: #{e.message}"
    end
  end
  
  # Processar mensagem WebSocket
  def self.process_websocket_message(message)
    begin
      data = JSON.parse(message)
      action = data['action']
      payload = data['payload']
      
      puts "[SketchUp Bridge v2] Processando ação: #{action}"
      
      case action
      when 'sendColor'
        handle_color_request(payload)
      when 'sendImage'
        handle_image_request(payload)
      when 'checkConnection'
        handle_connection_check
      else
        {
          action: 'response',
          originalAction: action,
          success: false,
          error: "Ação desconhecida: #{action}"
        }.to_json
      end
      
    rescue JSON::ParserError => e
      puts "[SketchUp Bridge v2] Erro ao analisar JSON: #{e.message}"
      {
        action: 'response',
        success: false,
        error: "Erro ao analisar JSON: #{e.message}"
      }.to_json
    rescue => e
      puts "[SketchUp Bridge v2] Erro ao processar mensagem: #{e.message}"
      {
        action: 'response',
        success: false,
        error: "Erro interno: #{e.message}"
      }.to_json
    end
  end
  
  # Manipular requisição HTTP
  def self.handle_http_request(client, first_line)
    method, path, version = first_line.split(" ")
    
    # Ler cabeçalhos
    headers = {}
    while (line = client.gets) && line.strip != ""
      key, value = line.split(": ", 2)
      headers[key.strip.downcase] = value.strip if key
    end
    
    # Ler corpo se presente
    body = ""
    content_length = headers["content-length"].to_i
    if content_length > 0
      body = client.read(content_length)
    end
    
    puts "[SketchUp Bridge v2] Requisição HTTP: #{method} #{path}"
    
    # Processar requisição
    response_body = ""
    status = 200
    
    begin
      case path
      when '/status'
        response_body = handle_connection_check
      when '/color'
        if method == 'POST'
          data = JSON.parse(body)
          response_body = handle_color_request(data)
        else
          status = 405
          response_body = { error: "Método não permitido" }.to_json
        end
      when '/image'
        if method == 'POST'
          data = JSON.parse(body)
          response_body = handle_image_request(data)
        else
          status = 405
          response_body = { error: "Método não permitido" }.to_json
        end
      else
        status = 404
        response_body = { error: "Não encontrado" }.to_json
      end
    rescue => e
      status = 500
      response_body = { error: "Erro interno: #{e.message}" }.to_json
    end
    
    # Enviar resposta HTTP
    send_http_response(client, status, response_body)
  end
  
  # Enviar resposta HTTP
  def self.send_http_response(client, status, body)
    status_text = case status
                  when 200 then "OK"
                  when 400 then "Bad Request"
                  when 404 then "Not Found"
                  when 405 then "Method Not Allowed"
                  when 500 then "Internal Server Error"
                  else "Unknown"
                  end
    
    response = [
      "HTTP/1.1 #{status} #{status_text}",
      "Content-Type: application/json",
      "Access-Control-Allow-Origin: *",
      "Access-Control-Allow-Methods: GET, POST, OPTIONS",
      "Access-Control-Allow-Headers: Content-Type",
      "Content-Length: #{body.bytesize}",
      "",
      body
    ].join("\r\n")
    
    client.write(response)
  end
  
  # Enviar erro HTTP
  def self.send_http_error(client, status, message)
    send_http_response(client, status, { error: message }.to_json)
  end
  
  # Manipular verificação de conexão
  def self.handle_connection_check
    {
      action: 'connectionStatus',
      isConnected: true,
      message: "Servidor SketchUp Bridge v2 ativo na porta #{SERVER_PORT}",
      version: '2.0.0',
      timestamp: Time.now.to_i
    }.to_json
  end
  
  # Manipular requisição de cor
  def self.handle_color_request(data)
    begin
      r = data['r'].to_i
      g = data['g'].to_i
      b = data['b'].to_i
      hex = data['hex']
      
      # Validar valores RGB
      if r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255
        raise "Valores RGB inválidos: R=#{r}, G=#{g}, B=#{b}"
      end
      
      # Criar material no SketchUp (executar na thread principal)
      material_name = nil
      UI.start_timer(0.1, false) do
        material_name = create_color_material(r, g, b, hex)
      end
      
      # Aguardar criação do material
      timeout = 0
      while material_name.nil? && timeout < 50 # 5 segundos
        sleep(0.1)
        timeout += 1
      end
      
      if material_name
        {
          action: 'response',
          originalAction: 'sendColor',
          success: true,
          data: {
            name: material_name,
            message: "Material criado com sucesso"
          }
        }.to_json
      else
        {
          action: 'response',
          originalAction: 'sendColor',
          success: false,
          error: "Timeout ao criar material"
        }.to_json
      end
      
    rescue => e
      puts "[SketchUp Bridge v2] Erro ao processar cor: #{e.message}"
      {
        action: 'response',
        originalAction: 'sendColor',
        success: false,
        error: e.message
      }.to_json
    end
  end
  
  # Manipular requisição de imagem
  def self.handle_image_request(data)
    begin
      image_id = data['imageId']
      type = data['type']
      
      unless ['material', 'component'].include?(type)
        raise "Tipo inválido: #{type}"
      end
      
      # Baixar imagem do servidor externo
      image_data = download_image_from_server(image_id)
      
      # Criar material ou componente (executar na thread principal)
      result_name = nil
      UI.start_timer(0.1, false) do
        if type == 'material'
          result_name = create_image_material(image_data, image_id)
        else
          result_name = create_image_component(image_data, image_id)
        end
      end
      
      # Aguardar criação
      timeout = 0
      while result_name.nil? && timeout < 100 # 10 segundos
        sleep(0.1)
        timeout += 1
      end
      
      if result_name
        {
          action: 'response',
          originalAction: 'sendImage',
          success: true,
          data: {
            name: result_name,
            type: type,
            message: "#{type.capitalize} criado com sucesso"
          }
        }.to_json
      else
        {
          action: 'response',
          originalAction: 'sendImage',
          success: false,
          error: "Timeout ao criar #{type}"
        }.to_json
      end
      
    rescue => e
      puts "[SketchUp Bridge v2] Erro ao processar imagem: #{e.message}"
      {
        action: 'response',
        originalAction: 'sendImage',
        success: false,
        error: e.message
      }.to_json
    end
  end
  
  # Baixar imagem do servidor externo
  def self.download_image_from_server(image_id)
    uri = URI("#{EXTERNAL_SERVER}?id=#{image_id}")
    puts "[SketchUp Bridge v2] Baixando imagem de: #{uri}"
    
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true if uri.scheme == 'https'
    http.read_timeout = 30
    
    request = Net::HTTP::Get.new(uri)
    response = http.request(request)
    
    if response.code == '200'
      data = JSON.parse(response.body)
      if data['success']
        puts "[SketchUp Bridge v2] Imagem baixada com sucesso."
        return data['imageData']
      else
        raise data['error'] || 'Erro ao baixar imagem'
      end
    else
      raise "Erro HTTP: #{response.code}"
    end
  end
  
  # Criar material com cor
  def self.create_color_material(r, g, b, hex)
    model = Sketchup.active_model
    materials = model.materials
    
    # Nome único para o material
    material_name = "Color_#{hex.gsub('#', '')}_#{Time.now.to_i}"
    
    # Criar material
    material = materials.add(material_name)
    material.color = Sketchup::Color.new(r, g, b)
    
    puts "[SketchUp Bridge v2] Material de cor criado: #{material_name} (#{hex})"
    
    return material_name
  end
  
  # Criar material com imagem
  def self.create_image_material(image_data, image_id)
    model = Sketchup.active_model
    materials = model.materials
    
    # Salvar imagem temporariamente
    temp_path = save_temp_image(image_data, image_id)
    puts "[SketchUp Bridge v2] Imagem temporária salva em: #{temp_path}"
    
    begin
      # Nome único para o material
      material_name = "Image_Material_#{image_id}_#{Time.now.to_i}"
      
      # Criar material
      material = materials.add(material_name)
      
      # Carregar textura
      material.texture = temp_path
      
      # Definir tamanho da textura (1 metro de largura)
      if material.texture
        # Obter dimensões da imagem
        image_width, image_height = get_image_dimensions(temp_path)
        
        if image_width && image_height
          # Calcular altura proporcional
          aspect_ratio = image_height.to_f / image_width.to_f
          texture_height = MATERIAL_WIDTH_METERS * aspect_ratio
          
          # Definir tamanho da textura
          model.start_operation('Aplicar Textura', true)
          material.texture.size = [MATERIAL_WIDTH_METERS.m, texture_height.m]
          model.commit_operation
          puts "[SketchUp Bridge v2] Textura redimensionada para #{MATERIAL_WIDTH_METERS.m}x#{texture_height.m}"
        end
      end
      
      # Aplicar a faces selecionadas se houver
      apply_material_to_selected_faces(material)
      
      puts "[SketchUp Bridge v2] Material de imagem criado: #{material_name}"
      
      return material_name
      
    ensure
      # Limpar arquivo temporário
      File.delete(temp_path) if File.exist?(temp_path)
    end
  end
  
  # Criar componente com imagem
  def self.create_image_component(image_data, image_id)
    model = Sketchup.active_model
    
    # Salvar imagem temporariamente
    temp_path = save_temp_image(image_data, image_id)
    puts "[SketchUp Bridge v2] Imagem temporária salva em: #{temp_path}"
    
    begin
      # Nome único para o componente
      component_name = "Image_Component_#{image_id}_#{Time.now.to_i}"
      
      # Obter dimensões da imagem
      image_width, image_height = get_image_dimensions(temp_path)
      
      if image_width && image_height
        # Calcular dimensões proporcionais
        aspect_ratio = image_height.to_f / image_width.to_f
        comp_height = MATERIAL_WIDTH_METERS * aspect_ratio
        
        # Criar definição do componente
        definition = model.definitions.add(component_name)
        
        # Criar face retangular no componente
        entities = definition.entities
        face = entities.add_face([0, 0, 0], [MATERIAL_WIDTH_METERS.m, 0, 0], 
                                [MATERIAL_WIDTH_METERS.m, comp_height.m, 0], [0, comp_height.m, 0])
        
        # Criar material para a textura
        material = model.materials.add("#{component_name}_Material")
        material.texture = temp_path
        material.texture.size = [MATERIAL_WIDTH_METERS.m, comp_height.m]
        
        # Aplicar material à face
        face.material = material
        
        # Configurar comportamento do componente
        definition.behavior.is2d = true
        definition.behavior.snapto = SketchupExtension::SNAPTO_VERTICAL
        
        # Criar instância do componente
        instance = model.active_entities.add_instance(definition, ORIGIN)
        
        puts "[SketchUp Bridge v2] Componente de imagem criado: #{component_name}"
        
        return component_name
      else
        raise "Não foi possível obter dimensões da imagem"
      end
      
    ensure
      # Limpar arquivo temporário
      File.delete(temp_path) if File.exist?(temp_path)
    end
  end
  
  # Salvar imagem temporária
  def self.save_temp_image(image_data, image_id)
    # Extrair dados base64
    base64_data = image_data.split(',')[1]
    image_content = Base64.decode64(base64_data)
    
    # Caminho temporário
    temp_dir = File.join(ENV['TEMP'] || '/tmp', 'sketchup_bridge_v2')
    Dir.mkdir(temp_dir) unless Dir.exist?(temp_dir)
    
    temp_path = File.join(temp_dir, "#{image_id}.png")
    
    # Salvar arquivo
    File.open(temp_path, 'wb') do |file|
      file.write(image_content)
    end
    
    return temp_path
  end
  
  # Obter dimensões da imagem
  def self.get_image_dimensions(image_path)
    begin
      # Tentar ler header PNG para obter dimensões
      File.open(image_path, 'rb') do |file|
        # Verificar assinatura PNG
        signature = file.read(8)
        return nil unless signature == "\x89PNG\r\n\x1a\n".force_encoding('BINARY')
        
        # Ler chunk IHDR
        file.read(4) # tamanho do chunk
        chunk_type = file.read(4)
        return nil unless chunk_type == 'IHDR'
        
        # Ler dimensões
        width = file.read(4).unpack('N')[0]
        height = file.read(4).unpack('N')[0]
        
        return [width, height]
      end
    rescue => e
      puts "[SketchUp Bridge v2] Erro ao obter dimensões da imagem: #{e.message}"
      return nil
    end
  end
  
  # Aplicar material a faces selecionadas
  def self.apply_material_to_selected_faces(material)
    model = Sketchup.active_model
    selection = model.selection
    
    faces_count = 0
    model.start_operation('Aplicar Material', true)
    selection.each do |entity|
      if entity.is_a?(Sketchup::Face)
        entity.material = material
        faces_count += 1
      end
    end
    model.commit_operation
    
    if faces_count > 0
      puts "[SketchUp Bridge v2] Material aplicado a #{faces_count} face(s) selecionada(s)"
    end
  end
  
  # Mostrar status do servidor
  def self.show_server_status
    if @@server_enabled
      status = "Ativo na porta #{SERVER_PORT}\nClientes conectados: #{@@clients.length}"
    else
      status = "Inativo"
    end
    UI.messagebox("Status do Servidor SketchUp Bridge v2:\n#{status}")
  end
  
  # Mostrar configurações
  def self.show_settings
    prompts = ["Porta do Servidor:", "Largura do Material (metros):"]
    defaults = [SERVER_PORT.to_s, MATERIAL_WIDTH_METERS.to_s]
    
    results = UI.inputbox(prompts, defaults, "Configurações do SketchUp Bridge v2")
    
    if results
      UI.messagebox("Configurações salvas! Reinicie o servidor para aplicar mudanças.")
    end
  end
  
  # Mostrar sobre
  def self.show_about
    about_text = <<~TEXT
      SketchUp Bridge v2.0.0
      
      Ponte de comunicação entre SketchUp e extensões do navegador via TCP/WebSocket.
      
      Funcionalidades:
      • Envio de imagens como materiais
      • Envio de imagens como componentes
      • Criação de cores a partir do RGB
      • Comunicação em tempo real via WebSocket
      
      Desenvolvido pela equipe SketchUp Bridge
      © 2025
    TEXT
    
    UI.messagebox(about_text, MB_OK, "Sobre SketchUp Bridge v2")
  end
  
  # UI.start_timer(0.1, false) { initialize_plugin } # Desativado para depuração de travamento
  
end

