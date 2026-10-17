# Express API gateway (uploads + Twilio WhatsApp webhook) -> forwards audio to the ML service and
# records each screening result in IBM Db2.
# Debian (glibc) rather than Alpine: the IBM Db2 driver (ibm_db) needs IBM's CLI driver, which is
# published for glibc Linux on x86_64 and s390x but not for musl/Alpine. The clidriver also needs libxml2.

# ibm_db downloads IBM's clidriver for the build platform and compiles its native addon here
FROM node:20-bookworm-slim AS deps
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates libxml2 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force \
    && node -e "require('ibm_db'); console.log('ibm_db OK on', process.arch)"

FROM node:20-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends libxml2 \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json *.js ./
RUN mkdir -p uploads && chown node:node uploads

USER node
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:5000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "server.js"]
