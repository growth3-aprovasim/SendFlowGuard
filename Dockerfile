# Imagem oficial do Node.js LTS
FROM node:22-alpine

# Definir diretório de trabalho
WORKDIR /app

# Instalar tzdata para timezone correto (America/Sao_Paulo)
RUN apk add --no-cache tzdata
ENV TZ=America/Sao_Paulo

# Copiar manifestos de dependências
COPY package*.json ./

# Instalar dependências de produção
RUN npm ci --omit=dev || npm install --omit=dev

# Copiar código fonte
COPY . .

# Porta padrão do dashboard
EXPOSE 3000

# Variáveis padrão
ENV PORT=3000
ENV NODE_ENV=production

# Comando de inicialização
CMD ["node", "src/index.js"]
