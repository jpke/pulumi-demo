import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as eks from "@pulumi/eks";
import * as k8s from "@pulumi/kubernetes";
import { createCert, createDNSRecord } from "./cert";
import { createNginx } from "./nginx";

const name = "eks";
const domainName = "jpearnest.com";
const subdomains = ["eks", "*.eks"];
const clusterDomain = `eks.${domainName}`;

// Create an EKS cluster with non-default configuration
const vpc = new awsx.ec2.Vpc("vpc", { subnets: [{ type: "public" }] });
const cluster = new eks.Cluster(name, {
    vpcId: vpc.id,
    subnetIds: vpc.publicSubnetIds,
    desiredCapacity: 3,
    minSize: 1,
    maxSize: 3,
    // storageClasses: "gp2",
    deployDashboard: false,
});

// Export the clusters' kubeconfig.
export const kubeconfig = cluster.kubeconfig

// to copy kubeconfig to local file:
// pulumi stack output kubeconfig > kubeconfig

export const cert = createCert(domainName, subdomains);

const nginxNamespace = new k8s.core.v1.Namespace("nginx", {metadata: {name: "nginx"}}, { provider: cluster.provider });

const nginxIngress = new k8s.helm.v3.Chart("nginx-ingress", {
    chart: "ingress-nginx",
    version: "3.35.0",
    namespace: "nginx",
    fetchOpts:{
        repo: "https://kubernetes.github.io/ingress-nginx",
    },
    values: {
        controller: {
            service: {
                annotations: {
                    "service.beta.kubernetes.io/aws-load-balancer-ssl-cert": cert.arn
                },
                targetPorts: {
                    https: "http"
                }
            }
        }
    }
},{
    provider: cluster.provider
});

const nginxService = nginxIngress.getResource("v1/Service", "nginx/nginx-ingress-ingress-nginx-controller");
export const nginxLoadBalancerUrl = nginxService.status.loadBalancer.ingress[0].hostname

const attachALBtoR53 = createDNSRecord(domainName, subdomains, nginxLoadBalancerUrl);

// Deploy nginx with classic loadbalancer
// export const nginx = createNginx("nginx-app", cluster.provider);

const prometheusNamespace = new k8s.core.v1.Namespace("prometheus", {metadata: {name: "prometheus"}}, { provider: cluster.provider });
const prometheus = new k8s.helm.v3.Chart("p8s", {
    namespace: "prometheus",
    chart: "prometheus",
    version: "13.8.0",
    fetchOpts:{
        repo: "https://prometheus-community.github.io/helm-charts",
    },
    values: {
        server: {
            ingress: {
                enabled: true,
                annotations: {
                    "kubernetes.io/ingress.class": "nginx"
                },
                hosts: [
                    nginxLoadBalancerUrl,
                    `prometheus.${clusterDomain}`
                ]
            }
        }
    }
},{
    provider: cluster.provider
});