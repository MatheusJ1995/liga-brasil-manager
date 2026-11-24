# ⚽ Liga Brasil Manager (MVP)

Jogo de gerenciamento de futebol online, estilo Brasfoot. Seus amigos entram por um link, criam uma conta, escolhem um clube e disputam um Brasileirão de 20 times (38 rodadas, pontos corridos).

## Como funciona

- **Jogos às quartas (21h30) e domingos (16h)**, horário de Brasília. A simulação é automática.
- **Escalação e formação podem ser mudadas até 1h antes** de cada partida. Depois disso, trava (no servidor, não dá para burlar).
- O resultado depende da qualidade dos jogadores escalados, da formação e de jogadores fora de posição (rendem menos). Mandante tem pequena vantagem.
- Times sem treinador humano jogam com a melhor escalação automática, então a liga nunca fica vazia.
- Se o servidor ficar fora do ar, as rodadas atrasadas são simuladas em ordem quando voltar.
- Ao fim das 38 rodadas, registra campeão e artilheiro e começa nova temporada.
- **Finanças:** cada clube tem caixa, recebe patrocínio/TV por rodada e paga salários (todo o elenco, cada jogador conforme a força). Nos jogos **em casa** há bilheteria: público = torcida × preço do ingresso × fase do time, limitado à capacidade do estádio. O treinador define o preço do ingresso (R$ 10 a R$ 300), com estimativa na hora. Preço baixo enche e rende pouco, preço alto afasta a torcida, existe um ponto ideal. O preço trava 1h antes da partida, junto com a escalação. Clubes sem treinador usam o preço padrão (que deixa dinheiro na mesa).
- **Mercado (troca entre amigos):** os treinadores negociam entre si. Um faz a proposta por um jogador do outro (dinheiro e/ou um jogador seu na troca) e o dono aceita ou recusa. A troca é imediata. Cada jogador tem um *valor de mercado* (sobe com a força, cai com a idade) e a oferta mínima é 50% desse valor. Regras:
  - **Janela de transferências:** só abre nas rodadas 1 a 5 e 19 a 24, e fecha 1h antes de cada partida (junto com a escalação).
  - **Transfer ban:** clube com **caixa negativo não pode contratar** nem receber jogadores em trocas, mas pode vender para se recuperar.
  - Não dá para oferecer mais dinheiro do que o caixa. Elenco de 18 a 28 jogadores (mín. 2 goleiros, 5 defensores, 5 meias, 3 atacantes). Até 5 propostas pendentes por clube.
  - Se o jogador vendido era titular, um reserva da mesma posição assume. Propostas de outros pelo mesmo jogador expiram.
- Os jogadores são **fictícios** (nomes gerados), só os clubes são reais.

## Rodar no seu computador

1. Instale o Node.js (versão 18 ou mais nova): https://nodejs.org
2. Abra o terminal na pasta do projeto e rode:
   ```
   node server.js
   ```
3. Acesse http://localhost:3000

Não precisa instalar mais nada (sem `npm install`). Testes das regras: `node test.js`.

## Colocar no ar para os amigos (passo a passo geral)

O jogo precisa de um servidor **ligado o tempo todo** (é ele que simula as rodadas) e de um **disco que não apaga** (guarda a liga em `data/state.json`).

1. Suba esta pasta para um repositório no GitHub.
2. Crie conta em um serviço de hospedagem que rode Node.js e ofereça disco persistente (por exemplo Railway, Fly.io, Render ou uma VPS barata). *Não verifiquei os preços e planos gratuitos atuais, confira no site de cada um.*
3. Configure o comando de início como `node server.js`.
4. Defina estas variáveis de ambiente:
   - `DATA_DIR` = pasta do disco persistente (ex.: `/data`)
   - `ADMIN_KEY` = uma senha sua, só se quiser a rota de teste de simulação (opcional)
5. O serviço dá um link público. É esse link que você manda para os amigos.

**Atenção a planos gratuitos:** muitos "dormem" quando ficam sem acesso e/ou apagam o disco a cada reinício. Dormir atrasa as rodadas até alguém acessar; apagar o disco **perde a liga inteira**. Para uma liga séria, use disco persistente.

## Testar sem esperar quarta/domingo

Com `ADMIN_KEY` definida, simula a próxima rodada na hora:

```
curl -X POST https://SEU-LINK/api/admin/simulate -H "x-admin-key: SUA_SENHA"
```

## Estrutura

| Arquivo | O que faz |
|---|---|
| `game.js` | Regras: times, jogadores, calendário, força, simulação |
| `server.js` | Servidor web, contas, API, agendador de rodadas, salvamento |
| `public/` | Telas do jogo (HTML/CSS/JS puro) |
| `test.js` | Testes automáticos das regras |
| `data/state.json` | A liga salva (criado sozinho) |

## Ainda não existe (próximas etapas sugeridas)

Você pediu um jogo completo; esta primeira versão é o núcleo jogável. Em ordem sugerida:

1. ~~Finanças~~ (feito nesta versão: caixa, salários, patrocínio e bilheteria)
2. ~~Mercado~~ (feito: troca entre treinadores, janela e transfer ban). Ideias futuras: leilão, jogadores livres e contratos
3. **Estádio**: capacidade, manutenção, preço do ingresso
4. **Táticas extras, lesões e cartões, categorias de base, copas, divisões e rebaixamento**

Limitações atuais: o mercado só funciona entre treinadores humanos (não há compra de clubes do computador nem jogadores livres), amigos combinados podem trocar jogadores por pouco dinheiro (o piso de 50% do valor limita, mas não impede), a capacidade do estádio é fixa, sem recuperação de senha, e uma conta por pessoa com um único clube.
