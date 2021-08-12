import * as aws from '@pulumi/aws'
import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'
import * as eks from "@pulumi/eks"


export function createPulumiOperator(kubeconfig: string, clusterOidcProvider: aws.iam.OpenIdConnectProvider) {
  
    const provider = new k8s.Provider('k8s', { kubeconfig });

    const operatorName = 'operator';
    new k8s.core.v1.Namespace(operatorName, {metadata: { name: operatorName }}, { provider });

    new k8s.yaml.ConfigFile("operator-crds", { file: "./operator/crds.yaml" });
  
    // Create the new IAM policy for the Service Account using the AssumeRoleWebWebIdentity action.
    const saAssumeRolePolicy = pulumi
        .all([clusterOidcProvider.url, clusterOidcProvider.arn])
        .apply(([url, arn]) =>
            aws.iam.getPolicyDocument(
                {
                    statements: [
                        {
                            actions: ['sts:AssumeRoleWithWebIdentity'],
                            conditions: [
                                {
                                    test: 'StringEquals',
                                    values: [`system:serviceaccount:${operatorName}:${operatorName}`], // namespace:name
                                    variable: `${url.replace('https://', '')}:sub`,
                                },
                            ],
                            effect: 'Allow',
                            principals: [{identifiers: [arn], type: 'Federated'}],
                        },
                    ],
                }
            )
        );
  
    // Create a new IAM role that assumes the AssumeRoleWebWebIdentity policy.
    const saRole = new aws.iam.Role(operatorName, {
        assumeRolePolicy: saAssumeRolePolicy.json,
    });

    // Attach the IAM role to an AWS S3 access policy.
    new aws.iam.RolePolicyAttachment(operatorName, {
        policyArn: 'arn:aws:iam::aws:policy/AmazonS3FullAccess',
        role: saRole,
    });
  
    // Create a Service Account with the IAM role annotated to use with the Pod.
    new k8s.core.v1.ServiceAccount(operatorName,
        {
            metadata: {
            namespace: operatorName,
            name: operatorName,
            annotations: {
                'eks.amazonaws.com/role-arn': saRole.arn,
            },
            },
        },
        { provider }
    ); 

    new k8s.rbac.v1.ClusterRole("operatorRole", {
        metadata: {
            name: operatorName,
        },
        rules: [
            {
                apiGroups: [""],
                resources: [
                    "pods",
                    "services",
                    "services/finalizers",
                    "endpoints",
                    "persistentvolumeclaims",
                    "events",
                    "configmaps",
                    "secrets",
                ],
                verbs: [
                    "create",
                    "delete",
                    "get",
                    "list",
                    "patch",
                    "update",
                    "watch",
                ],
            },
            {
                apiGroups: ["apps"],
                resources: [
                    "deployments",
                    "daemonsets",
                    "replicasets",
                    "statefulsets",
                ],
                verbs: [
                    "create",
                    "delete",
                    "get",
                    "list",
                    "patch",
                    "update",
                    "watch",
                ],
            },
            {
                apiGroups: ["monitoring.coreos.com"],
                resources: ["servicemonitors"],
                verbs: [
                    "create",
                    "get",
                ],
            },
            {
                apiGroups: ["apps"],
                resourceNames: [operatorName],
                resources: ["deployments/finalizers"],
                verbs: ["update"],
            },
            {
                apiGroups: [""],
                resources: ["pods"],
                verbs: ["get"],
            },
            {
                apiGroups: ["apps"],
                resources: [
                    "replicasets",
                    "deployments",
                ],
                verbs: ["get"],
            },
            {
                apiGroups: ["pulumi.com"],
                resources: ["*"],
                verbs: [
                    "create",
                    "delete",
                    "get",
                    "list",
                    "patch",
                    "update",
                    "watch",
                ],
            },
        ],
    });
    new k8s.rbac.v1.ClusterRoleBinding("operatorRoleBinding", {
        metadata: {
            name: operatorName,
            namespace: operatorName,
        },
        subjects: [{
            kind: "ServiceAccount",
            name: operatorName,
            namespace: operatorName,
        }],
        roleRef: {
            kind: "ClusterRole",
            name: operatorName,
            apiGroup: "rbac.authorization.k8s.io",
        },
    });
    new k8s.apps.v1.Deployment("operatorDeployment", {
        metadata: {
            name: operatorName,
            namespace: operatorName,
        },
        spec: {
            replicas: 1,
            selector: {
                matchLabels: {
                    name: operatorName,
                },
            },
            template: {
                metadata: {
                    labels: {
                        name: operatorName,
                    },
                },
                spec: {
                    serviceAccountName: operatorName,
                    imagePullSecrets: [{
                        name: operatorName,
                    }],
                    containers: [{
                        name: operatorName,
                        image: "pulumi/pulumi-kubernetes-operator:v0.0.16",
                        args: ["--zap-level=debug"],
                        imagePullPolicy: "Always",
                        env: [
                            {
                                name: "WATCH_NAMESPACE",
                                valueFrom: {
                                    fieldRef: {
                                        fieldPath: "metadata.namespace",
                                    },
                                },
                            },
                            {
                                name: "POD_NAME",
                                valueFrom: {
                                    fieldRef: {
                                        fieldPath: "metadata.name",
                                    },
                                },
                            },
                            {
                                name: "OPERATOR_NAME",
                                value: operatorName,
                            },
                        ],
                    }],
                },
            },
        },
    });
}