FROM node:20-alpine

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm install

COPY frontend /app/frontend

EXPOSE 3000

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3000"]
