import * as pulumi from "@pulumi/pulumi"
import * as aws from "@pulumi/aws";

export function createCert(domainName: string, subdomains: Array<string>) {

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

  const certValidationRecords = cert.domainValidationOptions.apply((dvos) => dvos.map((dvo) => {
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

  const certValidation = new aws.acm.CertificateValidation("certValidation", {certificateArn: cert.arn});

  return {
    arn: cert.arn,
  }
}

export function createDNSRecord(domainName: string, subdomains: Array<string>, alb_url: pulumi.Output<string>) {

  const r53zone = aws.route53.getZone({
      name: `${domainName}.`,
      privateZone: false,
  });

  const subdomainRecords = subdomains.map((subdomain) => {
    return new aws.route53.Record(`${subdomain}.${domainName}`, {
        zoneId: r53zone.then(r53zone => r53zone.zoneId),
        name: `${subdomain}.${domainName}`,
        type: "CNAME",
        ttl: 300,
        records: [alb_url],
    });
  })
}