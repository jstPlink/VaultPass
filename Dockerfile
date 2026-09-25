# --- Dipendenze: better-sqlite3 è un modulo nativo; se il binario precompilato
# non è disponibile per l'architettura del NAS (x86_64 / arm64) viene compilato qui.
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- Immagine finale
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY public ./public
RUN mkdir -p /app/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:' + (process.env.PORT || 3000) + '/', (r) => { r.resume(); process.exitCode = r.statusCode === 200 ? 0 : 1; r.on('end', () => process.exit()); }).on('error', () => process.exit(1))"

CMD ["node", "server/index.js"]
