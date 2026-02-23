FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN mkdir -p /app/data/weekly-plans && chown -R node:node /app/data \
    && touch /home/node/.claude.json && chown node:node /home/node/.claude.json

USER node

CMD ["npm", "run", "dev"]
