import * as pulumi from "@pulumi/pulumi"
import * as k8s from "@pulumi/kubernetes";

export function createNginx(name: string, host: string, provider: pulumi.ProviderResource) {

    const ns = new k8s.core.v1.Namespace(name, {metadata: { name }}, { provider });
    const namespaceName = ns.metadata.apply(m => m.name);

    const appLabels = { appClass: name };
    new k8s.apps.v1.Deployment(name,
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
        { provider }
    );

    const service = new k8s.core.v1.Service(name,
        {
            metadata: {
                labels: appLabels,
                namespace: namespaceName,
            },
            spec: {
                type: "ClusterIP",
                ports: [{ port: 80, targetPort: "http" }],
                selector: appLabels,
            },
        },
        { provider }
    );

    const nginxDomain = `nginx.${host}`;

    const ingress = new k8s.networking.v1.Ingress("nginx",
        {
            metadata: {
                name: "nginx",
                annotations: {
                    "kubernetes.io/ingress.class": "nginx"
                },
                namespace: namespaceName,
            },
            spec: {
                rules: [
                    {   host: nginxDomain,
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
        },
        { provider }
    );

  return nginxDomain

}

export function createPrometheus(name: string, host: string, provider: pulumi.ProviderResource) {

    new k8s.core.v1.Namespace("prometheus", {metadata: {name: "prometheus"}}, { provider });
    
    const prometheusDomain = `prometheus.${host}`;
    
    new k8s.helm.v3.Chart("prometheus",
        {
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
                            prometheusDomain
                        ]
                    }
                }
            }
        },{ provider }
    );

    return prometheusDomain
}