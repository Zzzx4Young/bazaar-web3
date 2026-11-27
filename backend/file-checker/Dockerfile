FROM clamav/clamav@sha256:8ad6197396974726c35d017e50aaaaf4b91745726a04faec8480c203edd98052
USER root
# This immutable base is Alpine 3.24.3. Resolve audited pins only from its
# stable release repositories; never mix in edge to recover a removed package.
RUN test "$(cut -d. -f1,2 /etc/alpine-release)" = 3.24 \
 && printf '%s\n' \
      'https://dl-cdn.alpinelinux.org/alpine/v3.24/main' \
      'https://dl-cdn.alpinelinux.org/alpine/v3.24/community' > /etc/apk/repositories \
 && apk add --no-cache python3=3.14.10-r2 py3-pillow=12.2.0-r0 qpdf=12.3.2-r0 \
 && freshclam --stdout
COPY file_checker.py /checker/file_checker.py
USER 65532:65532
ENTRYPOINT ["python3", "/checker/file_checker.py"]
