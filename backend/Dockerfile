FROM node:18-alpine

WORKDIR /app

RUN mkdir -p /app/logs

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 5000

CMD ["npm", "start"]
