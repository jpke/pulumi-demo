import * as pulumi from "@pulumi/pulumi"
import * as aws from "@pulumi/aws";

// creates an ACM cert, and corresponding DNS validation records; validates cert
export function createACMCert(domainName: string, subdomains: Array<string>) {

  const r53zone = aws.route53.getZone({
      name: `${domainName}.`
  });

  const cert = new aws.acm.Certificate("cert", {
      domainName: `${subdomains[0]}.${domainName}`,
      subjectAlternativeNames: subdomains.slice(1,subdomains.length).map(subdomain => `${subdomain}.${domainName}`),
      tags: {
          Environment: pulumi.getStack(),
      },
      validationMethod: "DNS",
  });

  let uniqueValidationDomains = new Array<string>();

  cert.domainValidationOptions.apply((dvos) => dvos.map((dvo) => {
    // create record only for unique resourceRecordNames
    if(uniqueValidationDomains.indexOf(dvo.resourceRecordName) === -1){
      uniqueValidationDomains.push(dvo.resourceRecordName);

      return new aws.route53.Record(`${dvo.domainName}-validate`, {
          zoneId: r53zone.then(r53zone => r53zone.zoneId),
          name: dvo.resourceRecordName,
          type: dvo.resourceRecordType,
          ttl: 300,
          records: [dvo.resourceRecordValue],
      });
    }
    return null
  }));

  new aws.acm.CertificateValidation("certValidation", {certificateArn: cert.arn});

  return {
    arn: cert.arn,
  }
}

// creates a CNAME record pointing a custom domain name to an aws load balancer
export function attachLbtoCustomDomain(domainName: string, subdomains: Array<string>, lb_url: pulumi.Output<string>) {

  const r53zone = aws.route53.getZone({
      name: `${domainName}.`,
      privateZone: false,
  });

  subdomains.map((subdomain) => {
    return new aws.route53.Record(`${subdomain}.${domainName}`, {
        zoneId: r53zone.then(r53zone => r53zone.zoneId),
        name: `${subdomain}.${domainName}`,
        type: "CNAME",
        ttl: 300,
        records: [lb_url],
    });
  })
}