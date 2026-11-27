FROM node:24-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

RUN mkdir -p /data

ENV NODE_ENV=production
ENV PORT=4000
ENV DATABASE_PATH=/data/attendance.db

EXPOSE 4000

CMD ["node", "src/index.ts"]
