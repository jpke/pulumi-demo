mkdir cluster-apps && cd cluster-apps

pulumi new kubernetes-typescript


# to copy kubeconfig to local file:
pulumi stack output kubeconfig > kubeconfig