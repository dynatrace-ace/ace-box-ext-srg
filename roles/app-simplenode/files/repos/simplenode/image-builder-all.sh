#!/bin/bash
#application version
APP_VERSION=3

docker build -t dynatraceace/simplenodeservice:1.0.$APP_VERSION .
docker push dynatraceace/simplenodeservice:1.0.$APP_VERSION

sed -i "s/=1/=2/" Dockerfile
docker build -t dynatraceace/simplenodeservice:2.0.$APP_VERSION .
docker push dynatraceace/simplenodeservice:2.0.$APP_VERSION

sed -i "s/=2/=3/" Dockerfile
docker build -t dynatraceace/simplenodeservice:3.0.$APP_VERSION .
docker push dynatraceace/simplenodeservice:3.0.$APP_VERSION

sed -i "s/=3/=4/" Dockerfile
docker build -t dynatraceace/simplenodeservice:4.0.$APP_VERSION .
docker push dynatraceace/simplenodeservice:4.0.$APP_VERSION

sed -i "s/=4/=5/" Dockerfile
docker build -t dynatraceace/simplenodeservice:5.0.$APP_VERSION .
docker push dynatraceace/simplenodeservice:5.0.$APP_VERSION

sed -i "s/=5/=1/" Dockerfile