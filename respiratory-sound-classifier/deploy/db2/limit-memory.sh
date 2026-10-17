#!/bin/bash
# Mounted into the Db2 container at /var/custom/: the Db2 image runs it after setup on every start.
# The image only sizes Db2 to the container memory limit under Kubernetes; under Docker Compose it
# would size itself to the host's RAM. Cap it below the db2 service's 3 GB limit instead.
mb=${DB2_INSTANCE_MEMORY_MB:-2048}
echo "(*) Limiting Db2 INSTANCE_MEMORY to ${mb} MB"
su - "${DB2INSTANCE:-db2inst1}" -c "db2 update dbm cfg using INSTANCE_MEMORY $((mb * 256)) immediate"
