import * as pulumi from "@pulumi/pulumi"
import * as k8s from "@pulumi/kubernetes";

export function createNginx(name: string, provider: pulumi.ProviderResource) {

  // Create a Kubernetes Namespace
  const ns = new k8s.core.v1.Namespace(name, {}, { provider });

  // Export the Namespace name
  const namespaceName = ns.metadata.apply(m => m.name);

  // Create a NGINX Deployment
  const appLabels = { appClass: name };
  const deployment = new k8s.apps.v1.Deployment(name,
      {
          metadata: {
              namespace: namespaceName,
              labels: appLabels,
          },
          spec: {
              replicas: 1,
              selector: { matchLabels: appLabels },
              template: {
                  metadata: {
                      labels: appLabels,
                  },
                  spec: {
                      containers: [
                          {
                              name: name,
                              image: "nginx:latest",
                              ports: [{ name: "http", containerPort: 80 }]
                          }
                      ],
                  }
              }
          },
      },
      {
          provider,
      }
  );

  // Export the Deployment name
  const deploymentName = deployment.metadata.apply(m => m.name);

  // Create a LoadBalancer Service for the NGINX Deployment
  const service = new k8s.core.v1.Service(name,
      {
          metadata: {
              labels: appLabels,
              namespace: namespaceName,
          },
          spec: {
              type: "LoadBalancer",
              ports: [{ port: 80, targetPort: "http" }],
              selector: appLabels,
          },
      },
      {
          provider,
      }
  );

  // Export the Service name and public LoadBalancer Endpoint
  return {
    namespaceName,
    deploymentName,
    serviceName: service.metadata.apply(m => m.name),
    serviceHostname: service.status.apply(s => s.loadBalancer.ingress[0].hostname)
  }

}