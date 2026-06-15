FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY server.js ./server.js
COPY public ./public

EXPOSE 8080
CMD ["npm", "start"]
