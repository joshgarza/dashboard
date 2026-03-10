FROM node:22-slim

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN mkdir -p /app/data/weekly-plans && chown -R node:node /app/data

USER node

CMD ["npm", "run", "dev"]
