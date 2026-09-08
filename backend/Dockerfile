# TradeForge sniper backend.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
# npm ci trips on the utf-8-validate optional-peer quirk in the lock file;
# npm install resolves it deterministically enough for this image.
RUN npm install --omit=dev

# gmgn-cli powers GMGN trending/trenches discovery (solana + robinhood).
# Without it the feeds log one warn and skip. GMGN_API_KEY arrives at
# runtime via the mounted backend/.env — never baked into the image.
RUN npm install -g gmgn-cli

COPY src ./src
COPY server.js ./

EXPOSE 4517
CMD ["node", "server.js"]
