FROM node:20-slim

WORKDIR /app

# Installe d'abord les dépendances (couche mise en cache tant que package.json
# ne change pas), puis le code applicatif.
COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

EXPOSE 8000
USER node
CMD ["node", "server.js"]
