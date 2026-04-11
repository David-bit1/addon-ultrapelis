# Usa una versión estable de Node
FROM node:20-slim

# Instalar dependencias de compilación necesarias para módulos nativos (better-sqlite3)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instalar dependencias
COPY package*.json ./
RUN npm install

# Copiar el código del proyecto
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]