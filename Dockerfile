# WEAVE container. The Qloo credential is supplied at runtime (QLOO_API_KEY), never baked into the image.
FROM node:22-slim
WORKDIR /app
# Pinned to the harness version the hackathon kit requires (0.1.26 or newer).
RUN npm install --global @qloo/qloo-harness@0.1.26 && npm cache clean --force
COPY package.json ./
COPY src ./src
COPY public ./public
ENV NODE_ENV=production PORT=3000 WEAVE_DEFAULT_MODE=demo QLOO_CLI=qloo
EXPOSE 3000
USER node
CMD ["node", "src/server.js"]
