FROM alpine:3.21

RUN apk add --no-cache vsftpd \
  && adduser -D -h /srv/ftp mibtest \
  && echo 'mibtest:mibtest' | chpasswd \
  && mkdir -p /srv/ftp \
  && chown -R root:root /srv/ftp

COPY vsftpd.conf /etc/vsftpd/vsftpd.conf
COPY mibs/ /srv/ftp/

EXPOSE 21 21100-21110
CMD ["vsftpd", "/etc/vsftpd/vsftpd.conf"]
