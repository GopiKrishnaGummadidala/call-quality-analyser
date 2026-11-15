FROM node:22 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27
ENV PUBLIC_HTTPS_PORT=443
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY nginx/15-self-signed-cert.sh /docker-entrypoint.d/15-self-signed-cert.sh
RUN chmod +x /docker-entrypoint.d/15-self-signed-cert.sh && rm -f /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80 443
