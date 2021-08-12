import * as aws from '@pulumi/aws'
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { createNginx, createPrometheus } from "./apps/createApps";
import { createPulumiOperator } from "./apps/operator/createPulumiOperator";

const config = new pulumi.Config();
const clusterStack = new pulumi.StackReference(config.get("clusterStack")!);

const clusterDomain = clusterStack.getOutput("clusterDomain");
const clusterOidcProvider = clusterStack.getOutput("clusterOidcProvider");

const kubeconfig = clusterStack.getOutput("kubeconfig");
const provider = new k8s.Provider("cluster", { kubeconfig });

pulumi.all([clusterDomain, clusterOidcProvider]).apply(([domain, oidc]) => {
    createPrometheus("prometheus", domain, provider)
    createPulumiOperator(oidc as unknown as aws.iam.OpenIdConnectProvider, provider)
    createNginx("nginx-app", domain, provider);
})

