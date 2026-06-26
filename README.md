# Corretor NR-33 — Espaço Confinado

Aplicação web (PWA) que **corrige cartões-resposta pela câmera**. Você imprime o
cartão-resposta, o aluno preenche as bolhas, e o app **fotografa o cartão e devolve
a nota automaticamente** — leitura óptica das marcações (OMR), 100% no aparelho.

Gabarito pré-configurado da avaliação **NR-33 — Segurança e Saúde no Trabalho em
Espaço Confinado** (Trabalhador Autorizado e Vigia).

> É um **corretor por imagem**: aponta a câmera para o cartão preenchido → nota na
> hora. Não há cadastro de alunos nem digitação de respostas.

---

## Como usar (3 passos)

1. **Imprimir o cartão** — na tela inicial, toque em **Imprimir cartão-resposta**.
   Imprima em papel A4 (1 folha por aluno). O cartão tem os 4 quadrados pretos nos
   cantos (usados para alinhar a leitura) — não risque sobre eles.
2. **Preencher** — o aluno preenche completamente a bolha da alternativa escolhida,
   com caneta azul/preta ou lápis. Uma alternativa por questão.
3. **Corrigir** — toque em **Corrigir prova**, enquadre o cartão na câmera (preencha
   a tela). Ao detectar os 4 cantos, a captura é automática e a **nota aparece na
   hora**, com a conferência de cada questão.

A tela de resultado mostra o cartão "desentortado" com a correção sobreposta
(verde = correto, vermelho = marcação errada) e a lista de leitura de cada questão.

**Campos opcionais** na tela de resultado (use se quiser; não são obrigatórios):
- **Ajustar a leitura** — toque numa alternativa caso a câmera leia errado.
- **Dissertativas (Q3/6/7)** — marque as corretas para incluí-las na nota.
- **Nome do aluno** e **Salvar** — guarda o resultado no histórico (exportável em CSV).

---

## O que é corrigido

A avaliação tem 10 questões. O app corrige automaticamente as **objetivas** (as que
têm bolhas):

| Questão | Tipo            | Gabarito |
|--------:|-----------------|:--------:|
| 1       | A/B/C           | **B**    |
| 2       | A/B/C           | **C**    |
| 4       | A/B/C/D         | **B**    |
| 5       | A/B/C/D/E       | **E**    |
| 8.1–8.9 | Verdadeiro/Falso| **V,V,F,V,V,V,V,F,V** |
| 9       | 1–5             | **3**    |
| 10      | A/B/C/D/E       | **C**    |

São **15 itens objetivos**. A nota é o percentual de acertos sobre esses itens, e
**Aprovado/Reprovado** usa a nota mínima configurável (padrão **70%**).

As questões **3, 6 e 7 são dissertativas** (texto escrito) e **não** entram na
correção automática — devem ser avaliadas à mão pelo instrutor.

O gabarito, a nota mínima e as alternativas podem ser ajustados em
**Gabarito e configurações** (ficam salvos no próprio aparelho).

---

## Rodar na web

Por exigência dos navegadores, a câmera só funciona em **HTTPS** (ou em
`localhost`). Qualquer servidor de arquivos estáticos serve.

**Teste local:**

```bash
# na pasta do projeto
python3 -m http.server 8000
# abra http://localhost:8000
```

**Publicar (GitHub Pages):** habilite o Pages apontando para a branch do projeto
(pasta raiz). O endereço `https://<usuario>.github.io/<repo>/` já roda com HTTPS, e
o cartão/câmera funcionam direto no celular.

---

## Instalar no celular (Android)

O app é uma **PWA** e pode ser instalado sem loja de aplicativos:

1. Abra o endereço HTTPS no **Chrome** do Android.
2. Menu **⋮ → Instalar aplicativo** (ou "Adicionar à tela inicial").
3. O ícone aparece como um app normal, abre em tela cheia e **funciona offline**
   (o OpenCV e os arquivos ficam em cache após o primeiro uso).

> Quer um APK "de verdade" (loja/instalação por arquivo)? Dá para empacotar esta
> PWA com **Bubblewrap/TWA** depois — a base já está pronta.

---

## Como funciona (técnico)

- **Sem servidor.** Tudo roda no navegador. Após o primeiro carregamento funciona
  **offline** (o Service Worker mantém o app e o OpenCV em cache).
- **Visão computacional:** [OpenCV.js](https://docs.opencv.org/) (carregado de CDN e
  guardado em cache para uso offline). O primeiro uso da câmera baixa ~10 MB.
- **Registro do cartão:** 4 marcadores fiduciais (quadrados pretos) nos cantos são
  detectados pelo centróide; uma homografia "desentorta" a perspectiva da foto.
  Robusto a inclinação, sombra, fundo escuro e cartão de cabeça para baixo.
- **Leitura das bolhas:** as posições são as **mesmas** usadas para gerar o cartão
  (`js/layout.js`), então o ponto amostrado cai exatamente sobre cada bolha. O
  preenchimento é calibrado por cartão (papel × tinta), tolerando variações de luz.

### Estrutura

```
index.html              # casca do app e telas
styles.css
manifest.webmanifest    # PWA
sw.js                   # service worker (offline)
js/
  config.js             # gabarito (respostas) + nota mínima
  layout.js             # geometria do cartão (fonte única p/ gerar e ler)
  card.js               # gera o cartão-resposta imprimível (SVG A4)
  omr.js                # detecção, perspectiva, leitura das bolhas e nota
  camera.js             # acesso à câmera (getUserMedia)
  storage.js            # histórico opcional de resultados + exportação CSV
  opencv-loader.js      # carrega o OpenCV sob demanda
  app.js                # interface e fluxo
icons/                  # ícones do PWA
```

---

## Dicas para uma boa leitura

- Boa iluminação, sem sombra forte sobre o cartão.
- Enquadre o cartão preenchendo a tela, com os **4 cantos** visíveis.
- Preencha bem a bolha (não só um tracinho) e evite rasuras.
- Marque **apenas uma** alternativa por questão (duas marcas próximas viram
  "múltiplas marcas" e a questão conta como não respondida).
