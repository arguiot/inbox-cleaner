# Security

Do not post Gmail content, refresh tokens, OAuth client secrets, Cloudflare API tokens, or private preview reports
in issues or pull requests. Use synthetic mail in tests. Local credentials and deployment identity files are ignored by Git.

Report suspected vulnerabilities privately through this repository's GitHub **Report a vulnerability** option
under the Security tab. Include reproduction steps with synthetic data and redact credentials.

Pull-request CI runs without deployment credentials. Deployment is restricted to `main` and the configured Cloudflare
account and token-owner email. Maintain the deployment environment's branch restriction when self-hosting.
