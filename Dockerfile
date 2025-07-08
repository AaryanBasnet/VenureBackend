#Select OS/ENVIRONMENT

FROM node:22-alpine

#Choose working directory inside docker
WORKDIR / app

#zcopy package.josn to install npm packages inside docker
#Copy source destination'
COPY package.json ./

#Running Shelll command
RUN npm install

#Copy rest of the Application
COPY . .

#Port Exposure
EXPOSE 5050

#Entry Point

CMD ["node", "index.js"]


