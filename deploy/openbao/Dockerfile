# OpenBao for Toolkien: official image + our config, policies and operator scripts.
# Build context: deploy/openbao/
FROM openbao/openbao:2.7.2

COPY --chown=openbao:openbao openbao.hcl /openbao/config/openbao.hcl
COPY --chown=openbao:openbao policies /openbao/policies
COPY --chown=openbao:openbao --chmod=0755 init.sh unseal.sh rotate.sh /openbao/scripts/

USER root
RUN mkdir -p /openbao/data && chown openbao:openbao /openbao/data && chmod 0700 /openbao/data
USER openbao

# The CLI inside the container talks to the local server
ENV BAO_ADDR=http://127.0.0.1:8200
VOLUME /openbao/data
EXPOSE 8200
# Healthy only when initialised and unsealed (`bao status` exits 2 while sealed)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD ["bao", "status"]
CMD ["bao", "server", "-config=/openbao/config/openbao.hcl"]
