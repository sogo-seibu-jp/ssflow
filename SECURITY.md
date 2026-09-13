# Security Policy

## Supported versions

The project currently supports the latest main branch.

## Reporting a vulnerability

Please report security issues privately by contacting the maintainer through the repository owner or the project administrator. Do not open a public GitHub issue for a suspected security vulnerability.

Please include:

- a short summary of the issue
- affected version or commit
- steps to reproduce
- impact and affected components
- suggested remediation if known

We will review the report and coordinate a fix or disclosure timeline.

## Local data handling

This application is designed to process data in the browser only. Uploaded CSV files and template data remain in the local browser storage until the user explicitly clears them.

We recommend:

- keeping the app on an internal or controlled hosting environment when processing staff data
- clearing browser storage after use on shared computers
- using HTTPS in production deployments

## Deployment hardening

Production deployments should use HTTPS, a strict Content Security Policy, and should avoid exposing staff data outside the browser environment.
