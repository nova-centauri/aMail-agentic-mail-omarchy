FROM alpine:3.21

ARG PROXY_UID=10002
ARG PROXY_GID=10002

RUN apk add --no-cache privoxy tor \
    && addgroup -g "${PROXY_GID}" -S torproxy \
    && adduser -u "${PROXY_UID}" -S -D -H -h /var/lib/tor -s /sbin/nologin -G torproxy torproxy \
    && mkdir -p /var/lib/tor \
    && touch /var/lib/tor/.volume-owner \
    && chown -R torproxy:torproxy /var/lib/tor \
    && chmod 0700 /var/lib/tor

COPY torrc /etc/tor/torrc
COPY privoxy.config /etc/privoxy/config
COPY entrypoint.sh /usr/local/bin/tor-proxy

RUN chmod 0555 /usr/local/bin/tor-proxy

USER torproxy

EXPOSE 8118

ENTRYPOINT ["/usr/local/bin/tor-proxy"]
