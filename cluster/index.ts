import * as pulumi from "@pulumi/pulumi";
import * as awsx from "@pulumi/awsx";
import * as eks from "@pulumi/eks";
import * as k8s from "@pulumi/kubernetes";
import { createACMCert, attachLbtoCustomDomain } from "./awsMethods";

const config = new pulumi.Config();
const name = config.get("clusterName");
const domainName = config.get("domainName");

export const subdomains = [`${name}`, `*.${name}`];
export const clusterDomain = `${name}.${domainName}`;

//
// EKS cluster
//
const vpc = new awsx.ec2.Vpc("vpc", { subnets: [{ type: "public" }] });
const cluster = new eks.Cluster(name!, {
    vpcId: vpc.id,
    subnetIds: vpc.publicSubnetIds,
    desiredCapacity: 2,
    minSize: 1,
    maxSize: 2,
    deployDashboard: false,
    createOidcProvider: true
});

export const kubeconfig = cluster.kubeconfig;
export const clusterOidcProvider = cluster.core.oidcProvider;

//
// ACM Cert
//
export const cert = createACMCert(domainName!, subdomains);


//
// Nginx Ingress Controller
//
const nginxNamespace = "nginx-ingress";
new k8s.core.v1.Namespace("nginx", {metadata: { name: nginxNamespace }}, { provider: cluster.provider });

const nginxIngress = new k8s.helm.v3.Chart("nginx-ingress",
    {
        chart: "ingress-nginx",
        version: "3.35.0",
        namespace: nginxNamespace,
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
    },{ provider: cluster.provider }
);

const nginxService = nginxIngress.getResource("v1/Service", `${nginxNamespace}/nginx-ingress-ingress-nginx-controller`);
export const nginxLoadBalancerUrl = nginxService.status.loadBalancer.ingress[0].hostname

//
// Attach load balancer to Route 53 subdomain 
//
attachLbtoCustomDomain(domainName!, subdomains, nginxLoadBalancerUrl);