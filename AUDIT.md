# Auditoria das versões 0.1.0 e 0.2.0

Data: 17 de julho de 2026

## Verificações concluídas

- Sintaxe dos módulos JavaScript principais.
- Integridade do catálogo e IDs únicos.
- Validade das notas, durações, BPM e dificuldades.
- Ligações entre aulas e músicas.
- Conversão de notas para MIDI e retorno para nomes de notas.
- Detector YIN com sinal sintético de 440 Hz.
- Existência de todos os arquivos essenciais da PWA.
- Manifesto com caminhos relativos para GitHub Pages.
- Recursos declarados no cache offline.
- Smoke test de interface em DOM simulado:
  - 8 aulas renderizadas;
  - 35 itens no catálogo;
  - 37 teclas virtuais;
  - pauta SVG renderizada;
  - toque na tecla-alvo avançando da nota 1 para a nota 2.

## Resultado

- 9/9 testes automatizados aprovados.
- Smoke test funcional aprovado.

## Pendente para validação em dispositivo real

- Calibração do microfone em piano acústico e digital.
- Testes de ruído, reverberação e distância do aparelho.
- Permissão e funcionamento do microfone em Android, iOS e desktop.
- Conexão Web MIDI nos navegadores compatíveis.
- Revisão musical das transcrições didáticas antes de publicação comercial.


## Modo Foco — versão 0.2.0

- Cabeçalho e navegação inferior são retraídos durante a prática.
- Partitura e teclado ocupam toda a área útil da tela.
- Controles secundários permanecem disponíveis em painel retrátil.
- O modo fecha ao voltar, trocar de seção ou pressionar Escape.
- Cache offline atualizado para incluir o novo módulo.
