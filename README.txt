TULIP — PROJECT MANAGEMENT APP
==============================

A modern, full-stack project management web application built for teams. 
Features role-based access control, real-time status tracking, Kanban boards, 
and a responsive dynamic user interface.

Live Demo: https://tulip-project-manager-2024-production.up.railway.app


KEY FEATURES
------------
* Authentication & RBAC: Secure JWT-based login/signup with Admin and Member roles. The first registered user automatically receives global Admin privileges.
* Project Management: Create projects, set due dates, and pick vibrant colors. Members can be added with specific "Project Admin" or "Member" roles.
* Task Kanban Board: A drag-and-drop-style interactive Kanban board for tracking task statuses (Todo, In Progress, Review, Done).
* Task Assignment: Assign team members to specific tasks, add priorities (Low to Critical), and set due dates. 
* Dynamic Dashboard: View overall statistics, in-progress workloads, overdue items, and a feed of recent activity.
* Rich Aesthetic UI: Vanilla CSS-based dynamic interface with modern glassmorphism, animated elements, and responsive styling.


TECHNOLOGY STACK
----------------
* Frontend: HTML5, Vanilla JavaScript (SPA architecture), Vanilla CSS
* Backend: Node.js, Express.js
* Database: SQLite3 (via better-sqlite3 for zero-config persistence)
* Security: bcryptjs (password hashing), jsonwebtoken (stateless authentication)
* Deployment: Railway (Nixpacks)


RUNNING LOCALLY
---------------
Prerequisites:
Make sure you have Node.js installed on your machine.

Setup Instructions:
1. Clone the repository
   git clone https://github.com/Ansh143550/tulipassignment.git
   cd tulipassignment

2. Install dependencies
   npm install

3. Start the server
   npm start

4. Open the App
   Open your browser and navigate to http://localhost:3000.


DEPLOYMENT
----------
This application is containerized and ready to deploy on Railway.
1. Connect your GitHub repository to Railway.
2. Railway will automatically detect the Node.js environment via Nixpacks.
3. No external database provisioning is required; the SQLite file is automatically generated in the local data directory.


SUBMISSION DETAILS
------------------
* Author: Ansh Kumar
* Timeframe: Built within 8-12 hours as per assignment requirements.
