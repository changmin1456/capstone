FROM node:20-alpine

WORKDIR /workspace/back_end/node_server

COPY node_server/package*.json ./
RUN npm ci --omit=dev

COPY node_server ./
COPY fast_server ../fast_server

EXPOSE 3000

CMD ["npm", "start"]
