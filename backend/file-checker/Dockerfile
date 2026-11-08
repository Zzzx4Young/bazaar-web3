FROM clamav/clamav@sha256:8ad6197396974726c35d017e50aaaaf4b91745726a04faec8480c203edd98052
USER root
RUN apk add --no-cache python3=3.14.10-r1 py3-pillow=12.2.0-r0 qpdf=12.3.2-r0 && freshclam --stdout
COPY file_checker.py /checker/file_checker.py
USER 65532:65532
ENTRYPOINT ["python3", "/checker/file_checker.py"]
