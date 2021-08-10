import * as pulumi from "@pulumi/pulumi";
import * as awsx from "@pulumi/awsx";
import * as eks from "@pulumi/eks";
import * as k8s from "@pulumi/kubernetes";
import { createACMCert, attachLbtoCustomDomain } from "./awsMethods";
import { createNginx } from "./nginx";

const name = "eks";
const domainName = "jpearnest.com";
const subdomains = ["eks", "*.eks"];
export const clusterDomain = `eks.${domainName}`;

//
// EKS cluster
//

const vpc = new awsx.ec2.Vpc("vpc", { subnets: [{ type: "public" }] });
const cluster = new eks.Cluster(name, {
    vpcId: vpc.id,
    subnetIds: vpc.publicSubnetIds,
    desiredCapacity: 2,
    minSize: 1,
    maxSize: 2,
    // storageClasses: "gp2",
    deployDashboard: false,
});

export const kubeconfig = cluster.kubeconfig

// // to copy kubeconfig to local file:
// // pulumi stack output kubeconfig > kubeconfig


//
// ACM Cert
//

export const cert = createACMCert(domainName, subdomains);


//
// Nginx Ingress Controller
//
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
                    "service.beta.kubernetes.io/aws-load-balancer-ssl-cert": cert.arn,
                    "service.beta.kubernetes.io/aws-load-balancer-backend-protocol": "http",
                    "service.beta.kubernetes.io/aws-load-balancer-ssl-ports": "https",
                    "service.beta.kubernetes.io/aws-load-balancer-connection-idle-timeout": '3600'
                },
                targetPorts: {
                    https: "http"
                }
            }
        }
    },
    transformations: [
        // remove helm hooks per https://github.com/pulumi/pulumi-kubernetes/issues/555
        (obj: any, opts: pulumi.CustomResourceOptions) => {
            if (obj.metadata?.annotations?.["helm.sh/hook"]) {
                delete obj.metadata.annotations["helm.sh/hook"];
            }
            if (obj.metadata?.annotations?.["helm.sh/hook-delete-policy"]) {
                delete obj.metadata.annotations["helm.sh/hook-delete-policy"];
            }
        }
    ]
},{
    provider: cluster.provider
});

const nginxService = nginxIngress.getResource("v1/Service", "nginx/nginx-ingress-ingress-nginx-controller");
export const nginxLoadBalancerUrl = nginxService.status.loadBalancer.ingress[0].hostname

//
// Custom Domain
//

attachLbtoCustomDomain(domainName, subdomains, nginxLoadBalancerUrl);

//
// Prometheus
//

export const prometheusDomain = `prometheus.${clusterDomain}`;
new k8s.core.v1.Namespace("prometheus", {metadata: {name: "prometheus"}}, { provider: cluster.provider });
new k8s.helm.v3.Chart("prometheus", {
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
                    prometheusDomain
                ]
            }
        }
    }
},{
    provider: cluster.provider
});

//
// Basic Nginx app
//

export const nginx = createNginx("nginx-app", clusterDomain, cluster.provider);