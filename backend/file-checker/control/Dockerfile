# Offline test fixture only; never configure this image in the application.
ARG BASE_IMAGE=bazaar-web3-private-check:t10
FROM ${BASE_IMAGE}
COPY control.py /checker/control.py
USER 65532:65532
ENTRYPOINT ["python3", "/checker/control.py"]
