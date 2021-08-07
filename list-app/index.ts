import * as awsx from "@pulumi/awsx";
import * as eks from "@pulumi/eks";
import * as k8s from "@pulumi/kubernetes";

// // Build and publish to an ECR registry.
// const repo = new awsx.ecr.Repository("my-repo");
// const image = repo.buildAndPushImage("./app");

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
                    image: awsx.ecr.buildAndPushImage("app-repo", "./app").image(),
                    ports: [{ name: "http", containerPort: 3000 }]
                }],
            }
        }
    },
}, { provider });
const service = new k8s.core.v1.Service(`${appName}`, {
    metadata: { labels: appLabels },
    spec: {
        type: "LoadBalancer",
        ports: [{ port: 80, targetPort: "http" }],
        selector: appLabels,
    },
}, { provider});

// Export the URL for the load balanced service.
export const url = service.status.loadBalancer.ingress[0].hostname;