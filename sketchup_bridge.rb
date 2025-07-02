# sketchup_bridge.rb - Arquivo de registro da extensão SketchUp Bridge v2
# Este arquivo é carregado automaticamente pelo SketchUp e registra a extensão

puts "[SketchUp Bridge v2] Carregando sketchup_bridge.rb..."

require 'sketchup'

# Informações da extensão
extension = SketchupExtension.new(
  'SketchUp Bridge v2',
  'SketchUpBridge/main.rb'
)

extension.description = 'Ponte de comunicação entre SketchUp e extensões do navegador via TCP/WebSocket. Permite envio de imagens como materiais/componentes e criação de cores.'
extension.version = '2.0.0'
extension.creator = 'SketchUp Bridge Team'
extension.copyright = '2025'

# Registrar a extensão
Sketchup.register_extension(extension, true)

# Chamar initialize_plugin após o registro para garantir a criação do menu
UI.start_timer(0.1, false) { SketchUpBridge.initialize_plugin }

puts "[SketchUp Bridge v2] Extensão registrada com sucesso."
