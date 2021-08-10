import * as awsx from "@pulumi/awsx";
import * as eks from "@pulumi/eks";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

// // Build and publish to an ECR registry.
const repository = new awsx.ecr.Repository("pulumi-repo");

// Point to existing K8s cluster.
const provider = new k8s.Provider("cluster", { kubeconfig: "../cluster/kubeconfig" });

// Create a NGINX Deployment and load balanced Service, running our app.
const appName = "list-app";
const appLabels = { appClass: appName };
const deployment = new k8s.apps.v1.Deployment(`${appName}`, {
    metadata: { labels: appLabels },
    spec: {
        replicas: 2,
        selector: { matchLabels: appLabels },
        template: {
            metadata: { labels: appLabels },
            spec: {
                containers: [{
                    name: appName,
                    image: repository.buildAndPushImage("./app"),
                    // image: awsx.ecr.buildAndPushImage("pulumi-repo", "./app",).image(),
                    ports: [{ name: "http", containerPort: 3000 }]
                }],
            }
        }
    },
}, { provider });
const service = new k8s.core.v1.Service(`${appName}`, {
    metadata: { labels: appLabels },
    spec: {
        type: "ClusterIP",
        ports: [{ port: 80, targetPort: "http" }],
        selector: appLabels,
    },
}, { provider});

const config = new pulumi.Config();
const clusterStack = new pulumi.StackReference(config.get("clusterStack")!);
const clusterDomain = clusterStack.getOutput("clusterDomain");

export const listAppDomain = clusterDomain.apply(domain => `list-app.${domain}`);

clusterDomain.apply(domain => {
    if(!domain) return;

    new k8s.networking.v1.Ingress("list-app", {
        metadata: {
            name: "list-app",
            annotations: {
                "kubernetes.io/ingress.class": "nginx"
            }
        },
        spec: {
            rules: [
                {   host: listAppDomain,
                    http: {
                        paths: [
                            {
                                path: "/",
                                pathType: "Prefix",
                                backend: {
                                    service: {
                                        name: service.metadata.name,
                                        port: {
                                            name: "http",
                                        }
                                    }
                                }
                            },
                        ],
                    },
                }
            ]
        },
    });
});