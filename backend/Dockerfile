FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p downloads

EXPOSE 5001

CMD ["node", "server.js"]
