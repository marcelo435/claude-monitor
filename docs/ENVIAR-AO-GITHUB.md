# Enviar ao GitHub

1. Crie seu repositório público no GitHub.
2. Extraia o ZIP `claude-monitor-github.zip` no computador.
3. Entre na pasta extraída. Selecione e envie **os arquivos e pastas dentro dela** pela opção **Add file → Upload files** do GitHub.
4. Confirme o commit.

Envie o conteúdo extraído, não apenas o ZIP. Assim, o README aparece na página inicial e o código pode ser aberto normalmente. A pasta `downloads` já contém o `.vsix` e o pacote completo para instalar em outro computador.

Também é possível enviar o código usando Git e publicar os arquivos de `downloads` em uma Release. O fluxo opcional em `.github/workflows/build.yml` faz os testes e empacota o aplicativo depois do upload; se o upload pelo navegador ocultar pastas que começam com ponto, elas continuam presentes neste ZIP para envio pelo Git.
