FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY index.mjs execution.mjs ./
COPY runtime ./runtime
RUN mkdir /data && chown node:node /data
USER node
ENV DATA_DIR=/data PORT=8081
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD node -e "fetch('http://localhost:8081/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","index.mjs"]
