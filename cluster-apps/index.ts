import * as aws from '@pulumi/aws'
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { createNginx, createPrometheus } from "../cluster/apps/createApps";
import { createPulumiOperator } from "../cluster/apps/operator/createPulumiOperator";

const config = new pulumi.Config();
const clusterStack = new pulumi.StackReference(config.get("clusterStack")!);
const clusterDomain = clusterStack.getOutput("clusterDomain");
const clusterOidcProvider = clusterStack.getOutput("clusterOidcProvider");
const kubeconfig = clusterStack.getOutput("kubeconfig");

const provider = new k8s.Provider("cluster", { kubeconfig });

const appLabels = { app: "nginx" };
const deployment = new k8s.apps.v1.Deployment("nginx", {
    spec: {
        selector: { matchLabels: appLabels },
        replicas: 1,
        template: {
            metadata: { labels: appLabels },
            spec: { containers: [{ name: "nginx", image: "nginx" }] }
        }
    }
}, { provider });
export const name = deployment.metadata.name;

createPrometheus("prometheus", clusterDomain as string, provider)

createPulumiOperator(kubeconfig as string, clusterOidcProvider as unknown as aws.iam.OpenIdConnectProvider)

createNginx("nginx-app", clusterDomain as string, provider);