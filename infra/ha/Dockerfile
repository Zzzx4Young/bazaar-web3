FROM postgres:17.11-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0

RUN apt-get -o Acquire::http::Timeout=20 -o Acquire::Retries=1 update \
    && apt-get -o Acquire::http::Timeout=20 -o Acquire::Retries=1 install -y --no-install-recommends python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/patroni
COPY requirements.txt /opt/ha/requirements.txt
RUN /opt/patroni/bin/pip install --no-cache-dir --timeout=30 --retries=1 -r /opt/ha/requirements.txt
COPY patroni-start.py patroni.json watchdog_policy.py /opt/ha/
ENTRYPOINT ["/opt/patroni/bin/python", "/opt/ha/patroni-start.py"]
