FROM node:18-alpine

RUN apk add --no-cache ffmpeg python3 make g++

WORKDIR /app

COPY package*.json ./

RUN npm install --production

COPY . .

RUN npm run build

ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "start"]

