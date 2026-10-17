# Express API gateway (uploads + Twilio WhatsApp webhook) -> forwards audio to the ML service.
FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js .
RUN mkdir -p uploads && chown node:node uploads

USER node
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:5000/api/health || exit 1

CMD ["node", "server.js"]
